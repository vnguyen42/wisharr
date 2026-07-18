import { useState } from "react";
import { api, usePolling } from "../api";
import { Card, Chip, Switch } from "../components";
import type { ApiConfig, ApiUser } from "../types";

export function Users({ onToast }: { onToast: (msg: string, err?: boolean) => void }) {
  const { data: users, refetch } = usePolling<ApiUser[]>("/api/users", 15_000);
  const { data: config, refetch: refetchConfig } = usePolling<ApiConfig>("/api/config", 60_000);
  const [saving, setSaving] = useState(false);

  async function toggleUser(user: ApiUser, sync: boolean) {
    if (!config) return;
    const current = new Set(config.plex.excludeUsers);
    if (sync) current.delete(user.title);
    else current.add(user.title);
    setSaving(true);
    try {
      await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ plex: { excludeUsers: [...current] } }),
      });
      onToast(sync ? `${user.title} will sync again` : `${user.title} excluded from sync`);
      refetch();
      refetchConfig();
    } catch (err) {
      onToast(`Save failed: ${(err as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Plex Home profiles"
      headExtra={<Chip tone="muted">{users?.length ?? 0} profiles</Chip>}
      noPad
    >
      {users && users.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Type</th>
                <th>Watchlist</th>
                <th>Overseerr account</th>
                <th>Token</th>
                <th>Sync</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.plexId}>
                  <td className="cell-main">
                    {u.title}
                    {u.protected && (
                      <span className="cell-muted" title="PIN-protected profile">
                        {" "}
                        🔒
                      </span>
                    )}
                  </td>
                  <td>
                    <Chip tone={u.admin ? "accent" : "muted"}>
                      {u.admin ? "admin" : u.managed ? "managed" : u.guest ? "guest" : "home"}
                    </Chip>
                  </td>
                  <td>{u.error ? <Chip tone="err">error</Chip> : (u.items ?? "—")}</td>
                  <td>
                    {u.overseerrUserId !== null ? (
                      <>
                        {u.title} <span className="cell-muted">#{u.overseerrUserId}</span>
                      </>
                    ) : (
                      <Chip tone="warn">no account — admin</Chip>
                    )}
                  </td>
                  <td>
                    <Chip tone={u.tokenCached === "none" ? "muted" : "ok"}>{u.tokenCached}</Chip>
                  </td>
                  <td>
                    <Switch
                      checked={!u.excluded}
                      disabled={saving}
                      label={`Sync ${u.title}`}
                      onChange={(next) => void toggleUser(u, next)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">Profiles appear after the first sync cycle.</div>
      )}
    </Card>
  );
}
