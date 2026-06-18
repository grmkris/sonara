import type { EnvironmentContext, LogLevel as EvlogLevel } from "evlog";
import { initLogger, log } from "evlog";

/**
 * Pino-compatible level set the rest of the codebase already speaks (matches
 * `env.LOG_LEVEL`). evlog only knows `debug < info < warn < error`, so the
 * extra pino levels are mapped onto the nearest evlog level and `silent`
 * disables emission entirely. See {@link LEVEL_MAP}.
 */
export type LogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace"
  | "silent";

/**
 * The pino-shaped surface the codebase depends on. Built on evlog's global
 * `log` API so existing call sites — including `logger.child({ ... })` — keep
 * working unchanged.
 */
export interface Logger {
  info: {
    (obj: Record<string, unknown>, msg?: string): void;
    (msg: string): void;
  };
  warn: {
    (obj: Record<string, unknown>, msg?: string): void;
    (msg: string): void;
  };
  debug: {
    (obj: Record<string, unknown>, msg?: string): void;
    (msg: string): void;
  };
  error: {
    (obj: unknown, msg?: string): void;
    (msg: string): void;
  };
  /** Returns a logger that merges `bindings` into every event it emits. */
  child: (bindings: Record<string, unknown>) => Logger;
}

export interface CreateLoggerConfig {
  /** Identifying tag attached to every event (pino's `name`). */
  name?: string;
  /** Minimum severity, pino-style. Mapped onto evlog's level set. */
  level?: LogLevel;
  /** Pretty (human) output vs single-line JSON. */
  pretty?: boolean;
  /** Service / environment context attached to every event. */
  env?: Partial<EnvironmentContext>;
}

const LEVEL_MAP: Record<Exclude<LogLevel, "silent">, EvlogLevel> = {
  debug: "debug",
  error: "error",
  fatal: "error",
  info: "info",
  trace: "debug",
  warn: "warn",
};

type EmitLevel = "info" | "warn" | "debug" | "error";

const toFields = (objOrMsg: unknown): Record<string, unknown> => {
  if (objOrMsg instanceof Error) {
    return { error: objOrMsg.message, stack: objOrMsg.stack };
  }
  if (typeof objOrMsg === "object" && objOrMsg !== null) {
    return { ...(objOrMsg as Record<string, unknown>) };
  }
  return { value: objOrMsg };
};

const buildLogger = (
  tag: string,
  bindings: Record<string, unknown>
): Logger => {
  const hasBindings = Object.keys(bindings).length > 0;

  const emit = (level: EmitLevel, objOrMsg: unknown, msg?: string): void => {
    // Fast path: a bare string with no bound context maps to evlog's tagged
    // form, which renders as `tag: message` in pretty output.
    if (typeof objOrMsg === "string" && !hasBindings) {
      log[level](tag, objOrMsg);
      return;
    }
    const fields =
      typeof objOrMsg === "string"
        ? { message: objOrMsg }
        : {
            ...toFields(objOrMsg),
            ...(msg === undefined ? {} : { message: msg }),
          };
    log[level]({ ...bindings, ...fields, tag });
  };

  return {
    child: (extra: Record<string, unknown>) =>
      buildLogger(tag, { ...bindings, ...extra }),
    debug: (objOrMsg: unknown, msg?: string) => emit("debug", objOrMsg, msg),
    error: (objOrMsg: unknown, msg?: string) => emit("error", objOrMsg, msg),
    info: (objOrMsg: unknown, msg?: string) => emit("info", objOrMsg, msg),
    warn: (objOrMsg: unknown, msg?: string) => emit("warn", objOrMsg, msg),
  } as Logger;
};

/**
 * Create the application logger. Configures evlog's global pipeline (level,
 * pretty/JSON, env) on each call — the last caller wins, which is exactly what
 * a single app singleton (plus silent loggers in tests) wants.
 */
export const createLogger = (config: CreateLoggerConfig = {}): Logger => {
  const tag = config.name ?? "sonara";
  const level = config.level ?? "info";

  initLogger({
    env: config.env,
    pretty: config.pretty,
    ...(level === "silent"
      ? { enabled: false }
      : { minLevel: LEVEL_MAP[level] }),
  });

  return buildLogger(tag, {});
};
