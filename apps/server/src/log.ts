export type LogLevel = "info" | "warn" | "error";
export type Logger = (level: LogLevel, message: string, data?: Record<string, unknown>) => void;

// One JSON line per event
export const jsonLogger: Logger = (level, message, data) => {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...data });
  if (level === "error") console.error(line);
  else console.log(line);
};

export const silentLogger: Logger = () => {};
