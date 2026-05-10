import { decodeEventLog, getAddress, parseAbiItem } from "viem";

// USDC contract on Base (chain 8453). Single source of truth for the
// `confirmTopUp` log-scanner.
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

// Subset of `viem`'s `TransactionReceipt` we actually inspect — defining it
// locally lets tests build receipts without dragging the full viem type.
export interface ReceiptLogLike {
  address: string;
  data: `0x${string}`;
  topics: readonly `0x${string}`[];
}

export interface TransferMatch {
  paidFrom: `0x${string}`;
  paidValue: bigint;
}

// Scan the receipt's logs for a USDC Transfer to `recipient` whose value is
// at least `expectedMin` (USDC's smallest units, i.e. usd * 10^6). Returns
// the first matching log's `{from, value}`, or null if no match. Non-Transfer
// logs and logs from contracts other than USDC are silently skipped.
//
// Caller is responsible for asserting `receipt.status === "success"` before
// calling — a reverted tx may still emit logs that decode cleanly, and this
// function will not detect that on its own.
export function findUsdcTransfer(
  logs: readonly ReceiptLogLike[],
  recipient: `0x${string}`,
  expectedMin: bigint,
): TransferMatch | null {
  const usdc = getAddress(USDC_BASE);
  for (const log of logs) {
    if (getAddress(log.address) !== usdc) continue;
    try {
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      });
      if (decoded.eventName !== "Transfer") continue;
      const { from, to, value } = decoded.args;
      if (getAddress(to) !== recipient) continue;
      if (value < expectedMin) continue;
      return { paidFrom: getAddress(from), paidValue: value };
    } catch {
      // Non-USDC or malformed log — skip.
    }
  }
  return null;
}

// USDC pack USD amount → smallest-unit minimum (USDC has 6 decimals).
export function expectedMinForUsd(usd: number): bigint {
  return BigInt(usd) * 10n ** BigInt(USDC_DECIMALS);
}
