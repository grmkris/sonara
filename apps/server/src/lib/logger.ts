import { createLogger } from "@sonara/logger";

import { env } from "../env";

export const logger = createLogger({
  env: { environment: env.APP_ENV, service: "sonara-server" },
  level: env.LOG_LEVEL,
  name: "sonara-server",
  pretty: env.APP_ENV !== "prod",
});

export type Logger = typeof logger;
