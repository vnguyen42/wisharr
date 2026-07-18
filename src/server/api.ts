import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import {
  type Config,
  configPath,
  overseerrSchema,
  radarrSchema,
  sonarrSchema,
} from "../config.js";
import { type LogEntry, log, logBuffer, logEvents } from "../logger.js";
import { plexHeaders, PLEX_TV } from "../plex/client.js";
import { isConfiguredToken } from "../plex/token-discovery.js";
import { OverseerrSink } from "../sinks/overseerr.js";
import { configUpdateSchema, updateConfigFile } from "./config-write.js";
import type { SyncManager } from "./manager.js";

export const VERSION = "0.3.1";

const SINK_SCHEMAS = {
  overseerr: overseerrSchema,
  radarr: radarrSchema,
  sonarr: sonarrSchema,
} as const;
type SinkName = keyof typeof SINK_SCHEMAS;

function isExcluded(config: Config, user: { title: string; admin: boolean }): boolean {
  return (
    config.plex.excludeUsers.includes(user.title) || (user.admin && !config.sync.includeOwner)
  );
}

export function buildApi(manager: SyncManager, rawConfiguredToken: string): Hono {
  const { config, store } = manager;
  // Resolved per call: rebuildSinks() replaces the instances.
  const overseerr = () =>
    manager.sinks.find((s): s is OverseerrSink => s instanceof OverseerrSink);
  const app = new Hono();

  app.get("/api/status", (c) => {
    const last = manager.lastReport;
    const users = last?.users ?? [];
    return c.json({
      version: VERSION,
      startedAt: manager.startedAt,
      running: manager.running,
      nextRunAt: manager.nextRunAt(),
      intervalMinutes: config.sync.intervalMinutes,
      plex: {
        tokenSource: isConfiguredToken(rawConfiguredToken) ? "config" : "auto-detected",
        profiles: users.length,
        managed: users.filter((u) => u.managed).length,
        guests: users.filter((u) => u.guest).length,
        errors: users.filter((u) => u.error).length,
      },
      sinks: manager.sinks.map((s) => ({ name: s.name })),
      lastCycle: last
        ? {
            startedAt: last.startedAt,
            durationMs: last.durationMs,
            newItems: users.reduce((n, u) => n + u.added.length, 0),
            seeded: users.reduce((n, u) => n + u.seeded, 0),
          }
        : null,
      totals: {
        trackedItems: store.trackedItemCount(),
        requests7d: store.requestCountSince(7),
      },
    });
  });

  app.get("/api/users", async (c) => {
    const users = manager.lastReport?.users ?? [];
    const sink = overseerr();
    const enriched = [];
    for (const u of users) {
      enriched.push({
        ...u,
        // Live view: the report's excluded flag is a snapshot from the last
        // cycle and would lag behind toggles made in the UI.
        excluded: isExcluded(config, u),
        tokenCached: u.admin ? "owner" : store.getToken(u.plexId) ? "cached" : "none",
        overseerrUserId: sink
          ? ((await sink.resolveRequester({ plexId: u.plexId, title: u.title })) ?? null)
          : null,
      });
    }
    return c.json(enriched);
  });

  app.get("/api/activity", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    return c.json(store.recentActivity(limit));
  });

  app.get("/api/logs", (c) =>
    streamSSE(c, async (stream) => {
      for (const entry of logBuffer) {
        await stream.writeSSE({ data: JSON.stringify(entry) });
      }
      let open = true;
      const onLine = (entry: LogEntry) => {
        if (open) void stream.writeSSE({ data: JSON.stringify(entry) });
      };
      logEvents.on("line", onLine);
      stream.onAbort(() => {
        open = false;
        logEvents.off("line", onLine);
      });
      // Keep the connection alive until the client goes away.
      while (open) {
        await new Promise((r) => setTimeout(r, 15_000));
        if (open) await stream.writeSSE({ event: "ping", data: "" });
      }
    }),
  );

  app.post("/api/sync", (c) => {
    if (manager.running) return c.json({ started: false, reason: "already running" }, 409);
    void manager.runCycle();
    log.info("sync triggered from the web UI");
    return c.json({ started: true }, 202);
  });

  app.get("/api/config", (c) =>
    c.json({
      plex: {
        tokenSource: isConfiguredToken(rawConfiguredToken) ? "config" : "auto-detected",
        excludeUsers: config.plex.excludeUsers,
        pinnedProfiles: Object.keys(config.plex.pins),
      },
      sync: config.sync,
      sinks: {
        overseerr: config.sinks.overseerr
          ? { url: config.sinks.overseerr.url, apiKeySet: true }
          : null,
        radarr: config.sinks.radarr
          ? {
              url: config.sinks.radarr.url,
              apiKeySet: true,
              qualityProfileId: config.sinks.radarr.qualityProfileId,
              rootFolderPath: config.sinks.radarr.rootFolderPath,
            }
          : null,
        sonarr: config.sinks.sonarr
          ? {
              url: config.sinks.sonarr.url,
              apiKeySet: true,
              qualityProfileId: config.sinks.sonarr.qualityProfileId,
              rootFolderPath: config.sinks.sonarr.rootFolderPath,
            }
          : null,
      },
    }),
  );

  app.put("/api/config", async (c) => {
    const parsed = configUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "invalid config" }, 400);
    }
    const update = parsed.data;

    // Sinks: merge the incoming fields over the existing config and make sure
    // the result is a complete, valid sink before anything is written.
    const validatedSinks: Partial<Record<SinkName, unknown>> = {};
    for (const [name, fields] of Object.entries(update.sinks ?? {}) as [
      SinkName,
      Record<string, unknown> | undefined,
    ][]) {
      if (!fields || Object.keys(fields).length === 0) continue;
      const merged = { ...(config.sinks[name] ?? {}), ...fields };
      const result = SINK_SCHEMAS[name].safeParse(merged);
      if (!result.success) {
        const issue = result.error.issues[0];
        return c.json(
          { error: `${name}: ${issue?.path.join(".") ?? ""} ${issue?.message ?? "invalid"}` },
          400,
        );
      }
      validatedSinks[name] = result.data;
    }

    updateConfigFile(configPath(), update);

    // Mirror the change in the running config so it applies without a restart.
    if (update.sync?.intervalMinutes !== undefined) {
      config.sync.intervalMinutes = update.sync.intervalMinutes;
      manager.schedule();
    }
    if (update.sync?.includeOwner !== undefined) config.sync.includeOwner = update.sync.includeOwner;
    if (update.sync?.seedOnFirstRun !== undefined) {
      config.sync.seedOnFirstRun = update.sync.seedOnFirstRun;
    }
    if (update.plex?.excludeUsers !== undefined) {
      config.plex.excludeUsers = update.plex.excludeUsers;
    }
    if (Object.keys(validatedSinks).length > 0) {
      Object.assign(config.sinks, validatedSinks);
      manager.rebuildSinks();
    }

    log.info("configuration updated from the web UI");
    return c.json({ ok: true });
  });

  app.post("/api/test/plex", async (c) => {
    try {
      const res = await fetch(`${PLEX_TV}/api/v2/ping`, {
        headers: plexHeaders(config.plex.token),
      });
      return c.json({ ok: res.ok, detail: res.ok ? "plex.tv reachable" : `HTTP ${res.status}` });
    } catch (err) {
      return c.json({ ok: false, detail: (err as Error).message });
    }
  });

  // Test a sink with candidate credentials from the UI (before saving), or
  // with the stored ones when the body omits them. Radarr/Sonarr replies
  // include quality profiles and root folders to populate the UI dropdowns.
  app.post("/api/test/:sink", async (c) => {
    const name = c.req.param("sink") as SinkName;
    if (!(name in SINK_SCHEMAS)) return c.json({ ok: false, detail: "unknown sink" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as { url?: string; apiKey?: string };
    const stored = config.sinks[name];
    const url = (body.url || stored?.url)?.replace(/\/+$/, "");
    const apiKey = body.apiKey || stored?.apiKey;
    if (!url || !apiKey) return c.json({ ok: false, detail: "url and API key required" });

    try {
      if (name === "overseerr") {
        const res = await fetch(`${url}/api/v1/status`, { headers: { "X-Api-Key": apiKey } });
        if (!res.ok) return c.json({ ok: false, detail: `HTTP ${res.status}` });
        const { version } = (await res.json()) as { version: string };
        return c.json({ ok: true, detail: `Overseerr v${version}` });
      }

      const headers = { "X-Api-Key": apiKey };
      const status = await fetch(`${url}/api/v3/system/status`, { headers });
      if (!status.ok) return c.json({ ok: false, detail: `HTTP ${status.status}` });
      const { version } = (await status.json()) as { version: string };
      const [profiles, folders] = await Promise.all([
        fetch(`${url}/api/v3/qualityprofile`, { headers }).then(
          (r) => r.json() as Promise<{ id: number; name: string }[]>,
        ),
        fetch(`${url}/api/v3/rootfolder`, { headers }).then(
          (r) => r.json() as Promise<{ path: string }[]>,
        ),
      ]);
      return c.json({
        ok: true,
        detail: `${name === "radarr" ? "Radarr" : "Sonarr"} v${version}`,
        qualityProfiles: profiles.map((p) => ({ id: p.id, name: p.name })),
        rootFolders: folders.map((f) => f.path),
      });
    } catch (err) {
      return c.json({ ok: false, detail: (err as Error).message });
    }
  });

  // Static frontend (built by web/) — API routes above take precedence.
  app.use("/*", serveStatic({ root: "web/dist" }));
  app.use("*", serveStatic({ path: "web/dist/index.html" }));

  return app;
}
