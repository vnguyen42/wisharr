import { EventEmitter } from "node:events";

type Level = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: Level;
  msg: string;
}

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;

const BUFFER_MAX = 500;

/** In-memory tail of recent log lines, for the web UI (replay + live SSE). */
export const logBuffer: LogEntry[] = [];
export const logEvents = new EventEmitter();
logEvents.setMaxListeners(50);

function emit(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg };
  logBuffer.push(entry);
  if (logBuffer.length > BUFFER_MAX) logBuffer.shift();
  logEvents.emit("line", entry);

  const line = `${entry.ts} [${level.toUpperCase().padEnd(5)}] ${msg}`;
  const args = extra ? [line, extra] : [line];
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(...args);
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit("error", msg, extra),
};
