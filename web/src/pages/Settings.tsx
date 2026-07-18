import { useState } from "react";
import { api, usePolling } from "../api";
import { Card, Chip, Switch } from "../components";
import { SinkCard } from "./SinkCard";
import type { ApiConfig } from "../types";

export function Settings({ onToast }: { onToast: (msg: string, err?: boolean) => void }) {
  const { data: config, refetch } = usePolling<ApiConfig>("/api/config", 60_000);
  const [plexTest, setPlexTest] = useState<{ ok: boolean; detail: string } | null>(null);
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

  async function runPlexTest() {
    try {
      setPlexTest(await api("/api/test/plex", { method: "POST" }));
    } catch (err) {
      setPlexTest({ ok: false, detail: (err as Error).message });
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
          <button className="btn" onClick={() => void runPlexTest()}>
            Test
          </button>
          {plexTest && <Chip tone={plexTest.ok ? "ok" : "err"}>{plexTest.detail}</Chip>}
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
            <div className="hint">Absorb the backlog of new sinks and new users silently</div>
          </div>
          <Switch
            checked={config.sync.seedOnFirstRun}
            label="Seed on first run"
            onChange={(next) =>
              void save(
                { sync: { seedOnFirstRun: next } },
                next ? "New sinks and users will be seeded" : "Backlogs will be pushed",
              )
            }
          />
        </div>
        <div className="form-row">
          <div className="form-label">
            <div className="name">Sync friends</div>
            <div className="hint">Watchlists of friends outside the Home (visibility permitting)</div>
          </div>
          <Switch
            checked={config.sync.friends}
            label="Sync friends"
            onChange={(next) =>
              void save(
                { sync: { friends: next } },
                next ? "Friends will sync from the next cycle" : "Friend sync disabled",
              )
            }
          />
        </div>
        <div className="form-row">
          <div className="form-label">
            <div className="name">Real-time RSS</div>
            <div className="hint">Plex Pass feeds polled every {config.sync.rssIntervalSeconds}s — restart to apply</div>
          </div>
          <Switch
            checked={config.sync.rss}
            label="Real-time RSS"
            onChange={(next) =>
              void save({ sync: { rss: next } }, "RSS setting saved — restart Wisharr to apply")
            }
          />
        </div>
        <div className="form-row">
          <div className="form-label">
            <div className="name">Removal sync</div>
            <div className="hint">
              Item off every watchlist → delete its request, unmonitor in Radarr/Sonarr. Only
              touches what Wisharr added; never deletes files.
            </div>
          </div>
          <Switch
            checked={config.sync.removal}
            label="Removal sync"
            onChange={(next) =>
              void save(
                { sync: { removal: next } },
                next ? "Removal sync enabled" : "Removal sync disabled",
              )
            }
          />
        </div>
      </Card>

      <Card title="Sinks">
        {(["overseerr", "radarr", "sonarr"] as const).map((name) => (
          <SinkCard
            key={name}
            name={name}
            config={config.sinks[name]}
            onSaved={refetch}
            onToast={onToast}
          />
        ))}
      </Card>
    </>
  );
}
