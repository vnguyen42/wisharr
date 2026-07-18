import { usePolling } from "../api";
import { Card, Chip, Tile, timeAgo } from "../components";
import type { ActivityEntry, Status } from "../types";

export function Dashboard({ status }: { status: Status | null }) {
  const { data: activity } = usePolling<ActivityEntry[]>("/api/activity?limit=30", 15_000);

  const lastCycle = status?.lastCycle ?? null;
  return (
    <>
      <div className="tiles">
        <Tile
          label="Watchlists"
          value={status ? status.plex.profiles + status.plex.friends : "—"}
          sub={
            status
              ? `${status.plex.profiles} Home (${status.plex.managed} managed) · ${status.plex.friends} friends`
              : undefined
          }
        />
        <Tile label="Tracked items" value={status?.totals.trackedItems ?? "—"} sub="across all watchlists" />
        <Tile label="Requests, last 7 days" value={status?.totals.requests7d ?? "—"} />
        <Tile
          label="Last cycle"
          value={
            lastCycle ? (
              <>
                {(lastCycle.durationMs / 1000).toFixed(1)}
                <small> s</small>
              </>
            ) : (
              "—"
            )
          }
          sub={
            lastCycle
              ? `${timeAgo(lastCycle.startedAt)} · ${lastCycle.newItems} new · ${
                  status!.plex.errors
                } error(s)`
              : "no cycle yet"
          }
        />
      </div>

      <div className="grid-2">
        <Card
          title="Plex"
          headExtra={
            status && status.plex.errors > 0 ? (
              <Chip tone="warn">{status.plex.errors} profile error(s)</Chip>
            ) : (
              <Chip tone="ok">Connected</Chip>
            )
          }
        >
          <div className="stack">
            <div>
              Admin token <Chip tone="accent">{status?.plex.tokenSource ?? "…"}</Chip>
            </div>
            <div>
              Real-time RSS{" "}
              {status?.rss === "active" ? (
                <Chip tone="ok">active</Chip>
              ) : status?.rss === "unavailable" ? (
                <Chip tone="warn">needs Plex Pass</Chip>
              ) : (
                <Chip tone="muted">off</Chip>
              )}
            </div>
            <div className="cell-muted">
              {status ? `${status.plex.profiles} Home profiles discovered` : "waiting for first cycle…"}
            </div>
            <div className="cell-muted">Watchlist source: discover.provider.plex.tv</div>
          </div>
        </Card>
        <Card title="Sinks" headExtra={<Chip tone="ok">{status?.sinks.length ?? 0} active</Chip>}>
          <div className="stack">
            {status?.sinks.map((s) => (
              <div key={s.name}>
                {s.name} <Chip tone="accent">configured</Chip>
              </div>
            ))}
            <div className="cell-muted">Requests attributed per user when an account matches.</div>
          </div>
        </Card>
      </div>

      <Card title="Recent activity" noPad>
        {activity && activity.length > 0 ? (
          <ul className="feed">
            {activity.map((a, i) => (
              <li key={`${a.at}-${i}`}>
                <time>{timeAgo(a.at)}</time>
                <span className="what">
                  <b>{a.title}</b>
                  {a.seeded ? " absorbed for " : ` requested in ${a.sink} for `}
                  <b>{a.user}</b>
                  {a.seeded && <Chip tone="muted">seeded</Chip>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">No activity yet — waiting for the first sync cycle.</div>
        )}
      </Card>
    </>
  );
}
