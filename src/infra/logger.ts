import { pino } from "pino";

export type Logger = {
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  fatal(obj: object | string, msg?: string): void;
};

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

export function createLogger(env: NodeJS.ProcessEnv = process.env): Logger {
  return pino({
    name: "mcp-idfm",
    level: env.LOG_LEVEL?.trim() || "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["PRIM_API_KEY", "apiKey", "*.apiKey", "*.PRIM_API_KEY"],
      censor: "[Redacted]",
    },
  });
}
