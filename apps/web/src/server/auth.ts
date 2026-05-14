import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, sql } from "drizzle-orm";
import {
  dodopayments,
  webhooks,
} from "@dodopayments/better-auth";
import DodoPayments from "dodopayments";
import {
  type IdTypePrefixNames,
  typeIdGenerator,
} from "@sonara/shared/typeid";
import { env } from "@/env";
import { createDb, SCHEMA, type Database } from "@sonara/db";
import { createDodoWebhookHandlers } from "./dodo-webhook";

// Map of Better Auth model names → our typeid prefix names. Identity here
// (auth models happen to match our convention), but explicit so a typo in
// either side surfaces at compile time.
const AUTH_MODEL_TO_PREFIX: Record<string, IdTypePrefixNames> = {
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",
};

export function createAuth(props: {
  db: Database;
  secret: string;
  baseURL: string;
  dodoApiKey: string;
  dodoWebhookSecret: string;
  dodoMode: "test_mode" | "live_mode";
}) {
  const { db, secret, baseURL, dodoApiKey, dodoWebhookSecret, dodoMode } =
    props;

  // Empty Dodo creds → skip the plugin entirely. Login + signup still work;
  // only the checkout/webhook surfaces are disabled.
  const dodoEnabled = dodoApiKey.length > 0 && dodoWebhookSecret.length > 0;
  const dodoClient = dodoEnabled
    ? new DodoPayments({ bearerToken: dodoApiKey, environment: dodoMode })
    : null;

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema: SCHEMA }),
    secret,
    baseURL,
    trustedOrigins: [baseURL],

    // Email + password is the sole auth method. Signup is gated by the
    // allowlist hook below — only addresses in `allowed_email` can register.
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      // No email verification yet (would need Resend / SES wired). Once an
      // email provider lands, flip this to true.
      requireEmailVerification: false,
      // Issue a session immediately on successful signup.
      autoSignIn: true,
    },

    // Defence-in-depth allowlist gate. Runs for every user create — must
    // have a row in `allowed_email` else 403.
    databaseHooks: {
      user: {
        create: {
          before: async (data) => {
            const normalised = data.email.toLowerCase().trim();
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

    plugins: dodoEnabled
      ? [
          dodopayments({
            client: dodoClient!,
            // Customer is created lazily on first checkout (see
            // creditsRouter.createCheckout). Keeping this `false` means signup
            // doesn't hit Dodo, so users can register even before the API key
            // is wired or if Dodo is down.
            createCustomerOnSignUp: false,
            use: [
              webhooks({
                webhookKey: dodoWebhookSecret,
                ...createDodoWebhookHandlers({ db }),
              }),
            ],
          }),
        ]
      : [],

    advanced: {
      database: {
        // Generate typeid-prefixed ids for the auth tables. The drizzle
        // adapter writes via our typeId customType which converts the
        // prefixed string into the underlying uuid on its way to Postgres.
        // Returning false from a model the map doesn't cover would let
        // Better Auth fall through to its own random string — we don't
        // expect to hit that branch, but it stays loud if we ever do.
        generateId: ({ model }) => {
          const prefix = AUTH_MODEL_TO_PREFIX[model];
          if (!prefix) {
            throw new Error(
              `Better Auth requested an id for unknown model "${model}"`,
            );
          }
          return typeIdGenerator(prefix);
        },
      },
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
    baseURL: env.APP_URL,
    dodoApiKey: env.DODO_PAYMENTS_API_KEY,
    dodoWebhookSecret: env.DODO_PAYMENTS_WEBHOOK_SECRET,
    dodoMode: env.DODO_PAYMENTS_MODE,
  });
  return cached;
}
