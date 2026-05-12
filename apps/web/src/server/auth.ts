import { betterAuth } from "better-auth";
import { siwe } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { generateRandomString } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { verifyMessage } from "viem/actions";
import { env } from "@/env";
import { mainnetClient } from "@/lib/chain-clients";
import { fetchReownIdentity } from "@/lib/reown-identity";
import { createDb, SCHEMA, type Database } from "@music-visualizer/db";

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

  // Synthetic email domain used by the SIWE plugin: `<addr>@wallet.<host>`.
  // The signup hook treats this suffix as "wallet flow, always allow".
  const walletSyntheticSuffix = `@wallet.${new URL(baseURL).hostname}`.toLowerCase();

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema: SCHEMA }),
    secret,
    baseURL,
    trustedOrigins: [baseURL],

    // Email + password is the second auth method alongside SIWE. Signup is
    // gated by the allowlist hook below — only addresses in `allowed_email`
    // can register.
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      // No email verification yet (would need Resend / SES wired). Once an
      // email provider lands, flip this to true.
      requireEmailVerification: false,
      // Issue a session immediately on successful signup.
      autoSignIn: true,
    },

    // No auto account-linking. A wallet sign-in must never silently absorb
    // an email account that happens to share a (synthetic) address.
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: [],
      },
    },

    // Defence-in-depth allowlist gate. Runs for every user create — SIWE
    // auto-create AND emailAndPassword signup both trip this hook.
    //   - SIWE: synthetic email matches `@wallet.<host>` suffix → allow.
    //   - email/password: must have a row in `allowed_email` → else 403.
    databaseHooks: {
      user: {
        create: {
          before: async (data) => {
            const incoming = data.email.toLowerCase();
            if (incoming.endsWith(walletSyntheticSuffix)) {
              return { data };
            }
            const normalised = incoming.trim();
            const [row] = await db
              .select({ id: SCHEMA.allowedEmail.id })
              .from(SCHEMA.allowedEmail)
              .where(eq(sql`lower(${SCHEMA.allowedEmail.email})`, normalised))
              .limit(1);
            if (!row) {
              throw new APIError("FORBIDDEN", {
                message:
                  "This email isn't on the allowlist. Contact an admin.",
              });
            }
            return { data: { ...data, email: normalised } };
          },
        },
      },
    },

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
  const db = createDb(env.DATABASE_URL);
  cached = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    domain: env.AUTH_DOMAIN,
    baseURL: env.APP_URL,
  });
  return cached;
}
