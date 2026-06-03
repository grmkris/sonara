import pino from "pino";
import { env } from "../env";

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.APP_ENV === "prod"
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
});

export type Logger = typeof logger;
