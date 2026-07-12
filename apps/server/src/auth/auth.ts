import { dodopayments, webhooks } from "@dodopayments/better-auth";
import { createDb, SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { dodoModeForEnv, SERVICE_URLS } from "@sonara/shared";
import type { DodoProductEnv } from "@sonara/shared";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type { IdTypePrefixNames } from "@sonara/shared/typeid";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import DodoPayments from "dodopayments";

import { env } from "../env";
import { createDodoWebhookHandlers } from "./dodo-webhook";

// Map of Better Auth model names → our typeid prefix names. Identity here
// (auth models happen to match our convention), but explicit so a typo in
// either side surfaces at compile time.
const AUTH_MODEL_TO_PREFIX: Record<string, IdTypePrefixNames> = {
  account: "account",
  session: "session",
  user: "user",
  verification: "verification",
};

export const createAuth = (props: {
  db: Database;
  secret: string;
  baseURL: string;
  dodoApiKey: string;
  dodoWebhookSecret: string;
  dodoMode: "test_mode" | "live_mode";
  dodoProductEnvMap: Record<DodoProductEnv, string>;
}) => {
  const {
    db,
    secret,
    baseURL,
    dodoApiKey,
    dodoWebhookSecret,
    dodoMode,
    dodoProductEnvMap,
  } = props;

  // Empty Dodo creds → skip the plugin entirely. Login + signup still work;
  // only the checkout/webhook surfaces are disabled.
  const dodoEnabled = dodoApiKey.length > 0 && dodoWebhookSecret.length > 0;
  const dodoClient = dodoEnabled
    ? new DodoPayments({ bearerToken: dodoApiKey, environment: dodoMode })
    : null;
  if (dodoEnabled && !dodoClient) {
    throw new Error("Dodo enabled but client failed to initialise");
  }

  return betterAuth({
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
              `Better Auth requested an id for unknown model "${model}"`
            );
          }
          return typeIdGenerator(prefix);
        },
      },
    },
    baseURL,
    database: drizzleAdapter(db, { provider: "pg", schema: SCHEMA }),

    // Email + password is the sole auth method. Signup is open — the
    // earlier allowlist gate was dropped when the public demo path landed
    // (unauthenticated visitors run the visualiser in demo-library mode;
    // signup unlocks live fal generation, gated downstream by the credits
    // ledger + free-tier). `allowed_email` table is unused but kept in the
    // schema as inert data until a follow-up migration removes it.
    emailAndPassword: {
      // Issue a session immediately on successful signup.
      autoSignIn: true,
      enabled: true,
      minPasswordLength: 12,
      // No email verification yet (would need Resend / SES wired). Once an
      // email provider lands, flip this to true.
      requireEmailVerification: false,
    },

    plugins: dodoEnabled
      ? [
          dodopayments({
            client: dodoClient as DodoPayments,
            // Customer is created lazily on first checkout (see
            // creditsRouter.createCheckout). Keeping this `false` means signup
            // doesn't hit Dodo, so users can register even before the API key
            // is wired or if Dodo is down.
            createCustomerOnSignUp: false,
            use: [
              webhooks({
                webhookKey: dodoWebhookSecret,
                ...createDodoWebhookHandlers({
                  db,
                  productEnvMap: dodoProductEnvMap,
                }),
              }),
            ],
          }),
        ]
      : [],
    secret,
    trustedOrigins: [baseURL],
  });
};

export type Auth = ReturnType<typeof createAuth>;

// Singleton — the Hono routes (auth handler, /rpc context, upload) share it.
let cached: Auth | null = null;
export const getAuth = (): Auth => {
  if (cached) {
    return cached;
  }
  const db = createDb(env.DATABASE_URL);
  cached = createAuth({
    baseURL: SERVICE_URLS[env.APP_ENV].web,
    db,
    dodoApiKey: env.DODO_PAYMENTS_API_KEY,
    dodoMode: dodoModeForEnv(env.APP_ENV),
    dodoProductEnvMap: {
      DODO_PRODUCT_MAX: env.DODO_PRODUCT_MAX,
      DODO_PRODUCT_PRO: env.DODO_PRODUCT_PRO,
      DODO_PRODUCT_STARTER: env.DODO_PRODUCT_STARTER,
    },
    dodoWebhookSecret: env.DODO_PAYMENTS_WEBHOOK_SECRET,
    secret: env.BETTER_AUTH_SECRET,
  });
  return cached;
};
