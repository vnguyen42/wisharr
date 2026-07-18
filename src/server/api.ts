import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { configPath } from "../config.js";
import { type LogEntry, log, logBuffer, logEvents } from "../logger.js";
import { plexHeaders, PLEX_TV } from "../plex/client.js";
import { isConfiguredToken } from "../plex/token-discovery.js";
import { OverseerrSink } from "../sinks/overseerr.js";
import { configUpdateSchema, updateConfigFile } from "./config-write.js";
import type { SyncManager } from "./manager.js";

export const VERSION = "0.3.0";

export function buildApi(manager: SyncManager, rawConfiguredToken: string): Hono {
  const { config, store, sinks } = manager;
  const overseerr = sinks.find((s): s is OverseerrSink => s instanceof OverseerrSink);
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
      sinks: sinks.map((s) => ({ name: s.name })),
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
    const enriched = [];
    for (const u of users) {
      enriched.push({
        ...u,
        tokenCached: u.admin ? "owner" : store.getToken(u.plexId) ? "cached" : "none",
        overseerrUserId: overseerr
          ? ((await overseerr.resolveRequester({ plexId: u.plexId, title: u.title })) ?? null)
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
        overseerr: config.sinks.overseerr ? { url: config.sinks.overseerr.url } : null,
        radarr: config.sinks.radarr ? { url: config.sinks.radarr.url } : null,
        sonarr: config.sinks.sonarr ? { url: config.sinks.sonarr.url } : null,
      },
    }),
  );

  app.put("/api/config", async (c) => {
    const parsed = configUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "invalid config" }, 400);
    }
    const update = parsed.data;

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

  app.post("/api/test/overseerr", async (c) => {
    if (!config.sinks.overseerr) return c.json({ ok: false, detail: "not configured" });
    try {
      const res = await fetch(`${config.sinks.overseerr.url}/api/v1/status`, {
        headers: { "X-Api-Key": config.sinks.overseerr.apiKey },
      });
      const detail = res.ok
        ? `Overseerr v${((await res.json()) as { version: string }).version}`
        : `HTTP ${res.status}`;
      return c.json({ ok: res.ok, detail });
    } catch (err) {
      return c.json({ ok: false, detail: (err as Error).message });
    }
  });

  // Static frontend (built by web/) — API routes above take precedence.
  app.use("/*", serveStatic({ root: "web/dist" }));
  app.use("*", serveStatic({ path: "web/dist/index.html" }));

  return app;
}
