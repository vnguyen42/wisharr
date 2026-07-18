import { Cron } from "croner";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { resolvePlexToken } from "./plex/token-discovery.js";
import { Store } from "./store.js";
import { buildSinks, runSync } from "./sync.js";

const config = loadConfig();
config.plex.token = await resolvePlexToken(config.plex.token);
const store = new Store(config.database);
const sinks = buildSinks(config);

let running = false;
async function cycle(seed = false) {
  if (running) {
    log.warn("previous sync still running, skipping this cycle");
    return;
  }
  running = true;
  try {
    await runSync(config, store, sinks, { seed });
  } catch (err) {
    log.error(`sync cycle failed: ${(err as Error).message}`);
  } finally {
    running = false;
  }
}

if (process.argv.includes("--seed")) {
  log.info("seeding: marking current watchlist items as synced, nothing will be pushed");
  await cycle(true);
  store.close();
} else if (process.argv.includes("--once")) {
  await cycle();
  store.close();
} else {
  log.info(
    `wisharr started — syncing every ${config.sync.intervalMinutes} min to: ${sinks.map((s) => s.name).join(", ")}`,
  );
  await cycle();
  new Cron(`*/${config.sync.intervalMinutes} * * * *`, () => cycle());
}
