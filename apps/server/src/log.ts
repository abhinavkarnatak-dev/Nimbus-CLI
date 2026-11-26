import pino from "pino";

export type LogLevel = "info" | "warn" | "error";
export type Logger = (level: LogLevel, message: string, data?: Record<string, unknown>) => void;

const base = pino({
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
});

// One JSON line per event
export const jsonLogger: Logger = (level, message, data) => base[level](data ?? {}, message);

export const silentLogger: Logger = () => {};
