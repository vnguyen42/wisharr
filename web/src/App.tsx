import { useEffect, useRef, useState } from "react";
import { api, usePolling } from "./api";
import { Dashboard } from "./pages/Dashboard";
import { Logs } from "./pages/Logs";
import { Settings } from "./pages/Settings";
import { Users } from "./pages/Users";
import type { Status } from "./types";

type Page = "dashboard" | "users" | "logs" | "settings";
const TITLES: Record<Page, string> = {
  dashboard: "Dashboard",
  users: "Users",
  logs: "Logs",
  settings: "Settings",
};

const icons: Record<Page, React.ReactNode> = {
  dashboard: (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="8.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="8.5" width="5" height="5" rx="1" />
      <rect x="8.5" y="8.5" width="5" height="5" rx="1" />
    </svg>
  ),
  users: (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="7.5" cy="5" r="2.6" />
      <path d="M2.5 13c.7-2.6 2.7-4 5-4s4.3 1.4 5 4" />
    </svg>
  ),
  logs: (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 3.5h11M2 7.5h11M2 11.5h7" />
    </svg>
  ),
  settings: (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="2.2" />
      <path d="M7.5 1.5v2M7.5 11.5v2M1.5 7.5h2M11.5 7.5h2M3.3 3.3l1.4 1.4M10.3 10.3l1.4 1.4M11.7 3.3l-1.4 1.4M4.7 10.3l-1.4 1.4" />
    </svg>
  ),
};

function useCountdown(nextRunAt: string | null): { label: string; seconds: number | null } {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!nextRunAt) return { label: "—", seconds: null };
  const seconds = Math.max(0, Math.round((Date.parse(nextRunAt) - now) / 1000));
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return { label: `${m}:${s}`, seconds };
}

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const { data: status, error: statusError, refetch } = usePolling<Status>("/api/status", 10_000);
  const { label: countdown, seconds } = useCountdown(status?.nextRunAt ?? null);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When the backend is unreachable, `status` freezes at its last value —
  // without this flag the countdown would sit at 00:00 pretending a sync is
  // running forever.
  const offline = statusError !== null;

  // A cycle lasts a few seconds — far less than the 10 s polling interval.
  // When the countdown hits zero, show the syncing state and poll fast until
  // the server hands back the next schedule.
  const syncing = !offline && (Boolean(status?.running) || seconds === 0);
  useEffect(() => {
    if (seconds !== 0 || offline) return;
    const fast = setInterval(refetch, 2000);
    return () => clearInterval(fast);
  }, [seconds === 0, offline]);

  function showToast(msg: string, err = false) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, err });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }

  async function syncNow() {
    try {
      await api("/api/sync", { method: "POST" });
      showToast(`Sync started — watching ${status?.plex.profiles ?? "all"} profiles`);
      setTimeout(refetch, 1500);
    } catch (err) {
      const message = (err as Error).message;
      showToast(message.includes("409") ? "A sync is already running" : `Sync failed: ${message}`, true);
    }
  }

  const healthy = status ? status.plex.errors === 0 : true;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <path
              d="M11 1.5 L13.2 8.8 L20.5 11 L13.2 13.2 L11 20.5 L8.8 13.2 L1.5 11 L8.8 8.8 Z"
              fill="var(--accent)"
            />
          </svg>
          <span className="brand-name">
            wish<em>arr</em>
          </span>
        </div>

        <div className="nav-label">Monitor</div>
        {(["dashboard", "users", "logs"] as const).map((p) => (
          <button
            key={p}
            className="nav-item"
            aria-current={page === p ? "page" : undefined}
            onClick={() => setPage(p)}
          >
            {icons[p]}
            {TITLES[p]}
            {p === "users" && (
              <span className="count">
                {status ? status.plex.profiles + status.plex.friends : ""}
              </span>
            )}
          </button>
        ))}

        <div className="nav-label">Configure</div>
        <button
          className="nav-item"
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => setPage("settings")}
        >
          {icons.settings}
          {TITLES.settings}
        </button>

        <div className="sidebar-foot">
          <span className={healthy ? "dot-ok" : "dot-err"}>●</span>{" "}
          {healthy ? "All systems healthy" : "Attention needed"}
          <br />
          wisharr v{status?.version ?? "…"}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1 className="page-title">{TITLES[page]}</h1>
          <div className="spacer" />
          <span className="next-sync">
            {offline ? (
              <span className="chip chip-err">backend unreachable</span>
            ) : syncing ? (
              <b>sync running…</b>
            ) : (
              <>next sync in <b>{countdown}</b></>
            )}
          </span>
          <button
            className="btn btn-primary"
            onClick={() => void syncNow()}
            disabled={syncing || offline}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M11 6.5a4.5 4.5 0 1 1-1.4-3.3M11 1v2.5H8.5" />
            </svg>
            Sync now
          </button>
        </header>

        <div className="content">
          {page === "dashboard" && <Dashboard status={status} />}
          {page === "users" && <Users onToast={showToast} />}
          {page === "logs" && <Logs />}
          {page === "settings" && <Settings onToast={showToast} />}
        </div>
      </div>

      {toast && (
        <div className={`toast${toast.err ? " toast-err" : ""}`} role="status">
          {toast.msg}
        </div>
      )}
    </div>
  );
}
