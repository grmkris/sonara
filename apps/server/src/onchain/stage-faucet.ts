import {
  createUsdcSender,
  readStagePayment,
  readUsdcBalance,
} from "@sonara/onchain";
import type { UsdcSender } from "@sonara/onchain";
import type { Address, Hex } from "viem";

import type { Logger } from "../lib/logger";

// Stage airdrop faucet: hands the audience enough testnet USDC to prompt with,
// from a server-held EOA (STAGE_FAUCET_KEY) — so nobody has to leave the show
// to visit faucet.circle.com. The faucet EOA doubles as the stage treasury, so
// every prompt payment flows straight back into the float: one browser-faucet
// seed keeps the whole demo loop running. A server-local singleton configured
// at boot, same rationale as stageRooms / stageState.

// One drip is 0.4 USDC — eight base-price prompts: generous per person while
// the float still covers ~90 unique wallets, and the treasury recycles every
// prompt payment so the loop stays close to self-sustaining.
const AIRDROP_UNITS = 400_000n;
// One drip per smart account per hour — enough for a show, dull to farm.
const COOLDOWN_MS = 60 * 60 * 1000;

export type StageDripResult =
  | { ok: true; txHash: string; units: string }
  | {
      ok: false;
      reason: "unavailable" | "already_funded" | "cooldown" | "faucet_dry";
    };

interface FaucetConfig {
  contract: Address;
  faucetKey: Hex;
  logger: Logger;
}

class StageFaucet {
  private config: FaucetConfig | null = null;
  private sender: UsdcSender | null = null;
  private usdc: Address | null = null;
  private promptPriceUnits = 0n;
  private readonly lastDripAt = new Map<string, number>();

  configure(config: FaucetConfig): void {
    this.config = config;
  }

  // Lazy: the payment config is immutable on the contract, read once on the
  // first drip rather than blocking boot on an RPC round-trip.
  private async init(config: FaucetConfig): Promise<UsdcSender> {
    if (this.sender) {
      return this.sender;
    }
    const { usdc, promptPriceUnits } = await readStagePayment({
      contract: config.contract,
    });
    this.usdc = usdc;
    this.promptPriceUnits = promptPriceUnits;
    this.sender = createUsdcSender({
      privateKey: config.faucetKey,
      usdc,
    });
    config.logger.info(
      { faucet: this.sender.address, usdc },
      "stage faucet ready"
    );
    return this.sender;
  }

  async drip(to: Address): Promise<StageDripResult> {
    const { config } = this;
    if (!config) {
      return { ok: false, reason: "unavailable" };
    }
    const key = to.toLowerCase();
    const last = this.lastDripAt.get(key);
    if (last !== undefined && Date.now() - last < COOLDOWN_MS) {
      return { ok: false, reason: "cooldown" };
    }

    const sender = await this.init(config);
    // Only top up wallets that can't afford a single prompt — an airdrop is a
    // way in, not an income.
    const balance = await readUsdcBalance({
      owner: to,
      usdc: this.usdc as Address,
    });
    if (balance >= this.promptPriceUnits) {
      return { ok: false, reason: "already_funded" };
    }
    if ((await sender.balanceUnits()) < AIRDROP_UNITS) {
      config.logger.warn(
        { faucet: sender.address },
        "stage faucet dry — seed it with USDC"
      );
      return { ok: false, reason: "faucet_dry" };
    }

    // Reserve the cooldown before sending so a double-tap can't double-drip.
    this.lastDripAt.set(key, Date.now());
    try {
      const txHash = await sender.transfer(to, AIRDROP_UNITS);
      config.logger.info({ to, txHash }, "stage faucet drip");
      return { ok: true, txHash, units: AIRDROP_UNITS.toString() };
    } catch (error) {
      this.lastDripAt.delete(key);
      config.logger.error({ error, to }, "stage faucet drip failed");
      return { ok: false, reason: "unavailable" };
    }
  }
}

export const stageFaucet = new StageFaucet();
