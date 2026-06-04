import { createLogger } from "@sonara/logger";
import { env } from "../env";

export const logger = createLogger({
  name: "sonara-server",
  level: env.LOG_LEVEL,
  pretty: env.APP_ENV !== "prod",
  env: { service: "sonara-server", environment: env.APP_ENV },
});

export type Logger = typeof logger;
