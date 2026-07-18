import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "./types";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Fetch JSON now and re-fetch on an interval; refetch() forces an update. */
export function usePolling<T>(path: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<T>(path)
        .then((d) => {
          if (alive) {
            setData(d);
            setError(null);
          }
        })
        .catch((e: Error) => {
          if (alive) setError(e.message);
        });
    void load();
    const timer = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path, intervalMs, tick]);

  return { data, error, refetch: () => setTick((t) => t + 1) };
}

const MAX_LINES = 500;

/** Live log lines over SSE, with automatic reconnection. */
export function useLogs(): LogEntry[] {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const buffer = useRef<LogEntry[]>([]);

  useEffect(() => {
    const source = new EventSource("/api/logs");
    // The server replays its backlog on every (re)connection — start clean.
    source.onopen = () => {
      buffer.current = [];
    };
    source.onmessage = (event) => {
      if (!event.data) return;
      buffer.current = [...buffer.current, JSON.parse(event.data) as LogEntry].slice(-MAX_LINES);
      setLines(buffer.current);
    };
    return () => source.close();
  }, []);

  return lines;
}
