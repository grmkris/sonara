import { betterAuth } from "better-auth";
import { siwe } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { generateRandomString } from "better-auth/crypto";
import { verifyMessage } from "viem/actions";
import { mainnetClient } from "@/lib/chain-clients";
import { fetchReownIdentity } from "@/lib/reown-identity";
import { createDb, SCHEMA, type Database } from "./db";

function ensureHex(value: string): `0x${string}` {
  if (!value.startsWith("0x")) throw new Error(`Invalid hex string: ${value}`);
  return value as `0x${string}`;
}

export function createAuth(props: {
  db: Database;
  secret: string;
  domain: string;
  baseURL: string;
}) {
  const { db, secret, domain, baseURL } = props;

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema: SCHEMA }),
    secret,
    baseURL,
    trustedOrigins: [baseURL],
    plugins: [
      siwe({
        domain,
        emailDomainName: `wallet.${new URL(baseURL).hostname}`,
        anonymous: true,
        getNonce: async () => generateRandomString(32, "a-z", "A-Z", "0-9"),
        verifyMessage: async ({ message, signature, address }) => {
          if (
            !signature.startsWith("0x") ||
            (signature.length - 2) % 2 !== 0
          ) {
            console.error("[siwe] signature is not valid hex", {
              length: signature.length,
            });
            return false;
          }
          // Smart-wallet-aware verification (ERC-1271 + ERC-6492) against
          // mainnet via the Reown-tuned public client.
          try {
            return await verifyMessage(mainnetClient, {
              address: ensureHex(address),
              message,
              signature: ensureHex(signature),
            });
          } catch (err) {
            console.error("[siwe] verifyMessage threw", err);
            return false;
          }
        },
        ensLookup: async ({ walletAddress }) => {
          const { name, avatar } = await fetchReownIdentity(walletAddress);
          return {
            name: name ?? walletAddress,
            avatar: avatar ?? "",
          };
        },
      }),
    ],
    advanced: {
      database: { generateId: false },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

// Singleton — Next.js route handlers + server components share this instance.
let cached: Auth | null = null;
export function getAuth(): Auth {
  if (cached) return cached;
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  const domain = process.env.AUTH_DOMAIN ?? "localhost:3000";
  const baseURL = process.env.APP_URL ?? "http://localhost:3000";
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  const db = createDb(databaseUrl);
  cached = createAuth({ db, secret, domain, baseURL });
  return cached;
}
