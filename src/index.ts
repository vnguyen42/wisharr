import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { resolvePlexToken } from "./plex/token-discovery.js";
import { buildApi } from "./server/api.js";
import { SyncManager } from "./server/manager.js";
import { Store } from "./store.js";

const config = loadConfig();
const rawConfiguredToken = config.plex.token;
config.plex.token = await resolvePlexToken(config.plex.token);
const store = new Store(config.database);
const manager = new SyncManager(config, store);

if (process.argv.includes("--seed")) {
  log.info("seeding: marking current watchlist items as synced, nothing will be pushed");
  await manager.runCycle(true);
  store.close();
} else if (process.argv.includes("--once")) {
  await manager.runCycle();
  store.close();
} else {
  log.info(
    `wisharr started — syncing every ${config.sync.intervalMinutes} min to: ${manager.sinks.map((s) => s.name).join(", ")}`,
  );
  manager.schedule();

  if (config.ui.enabled) {
    const app = buildApi(manager, rawConfiguredToken);
    serve({ fetch: app.fetch, port: config.ui.port }, (info) => {
      log.info(`web UI listening on http://localhost:${info.port}`);
    });
  }

  const shutdown = (signal: string) => {
    log.info(`${signal} received, shutting down`);
    manager.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await manager.runCycle();
}
