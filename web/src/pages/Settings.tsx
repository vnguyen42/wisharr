import { useState } from "react";
import { api, usePolling } from "../api";
import { Card, Chip, Switch } from "../components";
import type { ApiConfig } from "../types";

interface TestResult {
  ok: boolean;
  detail: string;
}

export function Settings({ onToast }: { onToast: (msg: string, err?: boolean) => void }) {
  const { data: config, refetch } = usePolling<ApiConfig>("/api/config", 60_000);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [interval, setIntervalValue] = useState<string | null>(null);

  async function save(update: object, message: string) {
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify(update) });
      onToast(message);
      refetch();
    } catch (err) {
      onToast(`Save failed: ${(err as Error).message}`, true);
    }
  }

  async function runTest(target: "plex" | "overseerr") {
    try {
      const result = await api<TestResult>(`/api/test/${target}`, { method: "POST" });
      setTests((t) => ({ ...t, [target]: result }));
    } catch (err) {
      setTests((t) => ({ ...t, [target]: { ok: false, detail: (err as Error).message } }));
    }
  }

  if (!config) return <div className="empty-state">Loading configuration…</div>;

  const intervalShown = interval ?? String(config.sync.intervalMinutes);

  return (
    <>
      <Card title="Plex">
        <div className="form-row">
          <div className="form-label">
            <div className="name">Admin token</div>
            <div className="hint">The only secret Wisharr needs</div>
          </div>
          <input
            className="input input-grow"
            type="password"
            value="••••••••••••••••••••"
            readOnly
            aria-label="Plex admin token"
          />
          <Chip tone="accent">{config.plex.tokenSource}</Chip>
          <button className="btn" onClick={() => void runTest("plex")}>
            Test
          </button>
          {tests.plex && (
            <Chip tone={tests.plex.ok ? "ok" : "err"}>{tests.plex.detail}</Chip>
          )}
        </div>
        <div className="form-row">
          <div className="form-label">
            <div className="name">Managed-user PINs</div>
            <div className="hint">Set in config.yml, only for protected profiles</div>
          </div>
          <Chip tone="muted">
            {config.plex.pinnedProfiles.length > 0
              ? config.plex.pinnedProfiles.join(", ")
              : "none required"}
          </Chip>
        </div>
      </Card>

      <Card title="Sync">
        <div className="form-row">
          <div className="form-label">
            <div className="name">Interval</div>
            <div className="hint">Minutes between watchlist polls</div>
          </div>
          <input
            className="input input-sm"
            type="number"
            min={1}
            max={1440}
            value={intervalShown}
            aria-label="Sync interval in minutes"
            onChange={(e) => setIntervalValue(e.target.value)}
            onBlur={() => {
              const minutes = Number(intervalShown);
              if (minutes >= 1 && minutes !== config.sync.intervalMinutes) {
                void save(
                  { sync: { intervalMinutes: minutes } },
                  `Sync interval set to ${minutes} min`,
                );
              }
              setIntervalValue(null);
            }}
          />
        </div>
        <div className="form-row">
          <div className="form-label">
            <div className="name">Include owner</div>
            <div className="hint">Sync the admin's own watchlist</div>
          </div>
          <Switch
            checked={config.sync.includeOwner}
            label="Include owner"
            onChange={(next) =>
              void save(
                { sync: { includeOwner: next } },
                next ? "Owner watchlist included" : "Owner watchlist excluded",
              )
            }
          />
        </div>
        <div className="form-row">
          <div className="form-label">
            <div className="name">Seed on first run</div>
            <div className="hint">Absorb a new sink's backlog silently</div>
          </div>
          <Switch
            checked={config.sync.seedOnFirstRun}
            label="Seed on first run"
            onChange={(next) =>
              void save(
                { sync: { seedOnFirstRun: next } },
                next ? "New sinks will be seeded" : "New sinks will receive the backlog",
              )
            }
          />
        </div>
      </Card>

      <Card title="Sinks">
        {(["overseerr", "radarr", "sonarr"] as const).map((name) => (
          <div className="form-row" key={name}>
            <div className="form-label">
              <div className="name">{name.charAt(0).toUpperCase() + name.slice(1)}</div>
              <div className="hint">
                {name === "overseerr" ? "Requests with per-user attribution" : "Direct adds"}
              </div>
            </div>
            {config.sinks[name] ? (
              <>
                <input
                  className="input input-grow"
                  type="text"
                  value={config.sinks[name]!.url}
                  readOnly
                  aria-label={`${name} URL`}
                />
                {name === "overseerr" && (
                  <button className="btn" onClick={() => void runTest("overseerr")}>
                    Test
                  </button>
                )}
                {name === "overseerr" && tests.overseerr && (
                  <Chip tone={tests.overseerr.ok ? "ok" : "err"}>{tests.overseerr.detail}</Chip>
                )}
              </>
            ) : (
              <Chip tone="muted">not configured — edit config.yml</Chip>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}
