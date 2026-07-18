import { useEffect, useRef, useState } from "react";
import { useLogs } from "../api";
import { Card } from "../components";

const LEVELS = ["all", "info", "warn", "error"] as const;
type LevelFilter = (typeof LEVELS)[number];

export function Logs() {
  const lines = useLogs();
  const [filter, setFilter] = useState<LevelFilter>("all");
  const viewRef = useRef<HTMLPreElement>(null);

  const visible = lines.filter((l) => filter === "all" || l.level === filter);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.scrollTop = view.scrollHeight;
  }, [visible.length]);

  return (
    <Card
      title="Live logs"
      headExtra={
        <div className="log-toolbar" role="group" aria-label="Filter by level">
          {LEVELS.map((level) => (
            <button
              key={level}
              className="chip-filter"
              aria-pressed={filter === level}
              onClick={() => setFilter(level)}
            >
              {level === "all" ? "All" : level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      }
      noPad
    >
      <pre className="log-view" ref={viewRef}>
        {visible.map((l, i) => (
          <span className="log-line" key={`${l.ts}-${i}`}>
            <span className="ts">{l.ts.slice(11, 19)}</span>{" "}
            <span className={`lvl lvl-${l.level}`}>[{l.level.toUpperCase().padEnd(5)}]</span>{" "}
            {l.msg}
          </span>
        ))}
        {visible.length === 0 && <span className="log-line">No log lines yet.</span>}
      </pre>
    </Card>
  );
}
