"use client";

import {
  createSIWEConfig,
  formatMessage,
  getAddressFromMessage,
  getChainIdFromMessage,
  type SIWECreateMessageArgs,
} from "@reown/appkit-siwe";
import { getAccount } from "wagmi/actions";
import { authClient } from "./auth-client";
import { wagmiConfig, chainIds } from "./wagmi-config";

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/i;
const EMBEDDED_FLOW_FLAG = "siwe-embedded-flow";

export const siweConfig = createSIWEConfig({
  getMessageParams: async () => ({
    domain: window.location.host,
    uri: window.location.origin,
    chains: chainIds,
    statement: "Sign in to Dream Visualizer",
  }),

  getNonce: async (address?: string) => {
    const account = getAccount(wagmiConfig);
    const isValidAddress = !!address && ETH_ADDRESS_REGEX.test(address);
    const walletAddress = isValidAddress ? address : account.address;

    if (!walletAddress) {
      // Embedded-wallet (social/email login) flow: Reown calls getNonce with
      // a placeholder '<<AccountAddress>>' before the wallet exists. Return
      // a client-generated nonce; verifyMessage will register a real one
      // server-side once the embedded wallet address is known.
      sessionStorage.setItem(EMBEDDED_FLOW_FLAG, "1");
      return crypto.randomUUID().replace(/-/g, "");
    }

    const { data, error } = await authClient.siwe.nonce({
      walletAddress,
      chainId: account.chainId ?? 1,
    });
    if (error || !data?.nonce) throw new Error("Failed to get nonce");
    return data.nonce;
  },

  createMessage: ({ address, ...args }: SIWECreateMessageArgs) =>
    formatMessage(args, address),

  verifyMessage: async ({ message, signature }) => {
    const address = getAddressFromMessage(message);
    const rawChainId = getChainIdFromMessage(message);
    const parsed = rawChainId.includes(":")
      ? rawChainId.split(":")[1]
      : rawChainId;
    if (!parsed) throw new Error("Invalid chain ID in SIWE message");
    const chainId = Number(parsed);

    // Idempotency guard: AppKit's auto-reconnect calls verifyMessage on every
    // page load when the embedded wallet has a cached session. If better-auth
    // already has a session for this address, short-circuit — otherwise we
    // spam the backend and risk a transient verify failure auto-disconnecting
    // the user. Better-auth creates emails as `${checksumAddress}@${domain}`
    // (anonymous: true), so the email's local part identifies the wallet.
    try {
      const existing = await authClient.getSession();
      const existingEmail = existing?.data?.user?.email;
      const existingAddress = existingEmail?.split("@")[0];
      if (
        existingAddress &&
        existingAddress.toLowerCase() === address.toLowerCase()
      ) {
        sessionStorage.removeItem(EMBEDDED_FLOW_FLAG);
        return true;
      }
    } catch {
      // Fall through to full verify on any session-check failure
    }

    // Embedded-wallet flow: no server-side nonce exists for the real address
    // (getNonce ran with a placeholder). Register one now so better-auth's
    // verify endpoint can find it. Our backend verifyMessage callback uses
    // viem and only checks the signature — the nonce value isn't compared
    // against the SIWE message.
    if (sessionStorage.getItem(EMBEDDED_FLOW_FLAG) === "1") {
      sessionStorage.removeItem(EMBEDDED_FLOW_FLAG);
      const { error: nonceError } = await authClient.siwe.nonce({
        walletAddress: address,
        chainId,
      });
      if (nonceError) return false;
    }

    const { error } = await authClient.siwe.verify({
      message,
      signature,
      walletAddress: address,
      chainId,
    });
    return !error;
  },

  getSession: async () => {
    const { data } = await authClient.getSession();
    if (!data?.session) return null;
    const account = getAccount(wagmiConfig);
    if (!account.address) return null;
    return {
      address: account.address,
      chainId: account.chainId ?? 1,
    };
  },

  signOut: async () => {
    await authClient.signOut();
    return true;
  },

  signOutOnDisconnect: true,
  signOutOnAccountChange: true,
  signOutOnNetworkChange: false,
});
