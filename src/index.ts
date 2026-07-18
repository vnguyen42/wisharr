import { Cron } from "croner";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { Store } from "./store.js";
import { buildSinks, runSync } from "./sync.js";

const config = loadConfig();
const store = new Store(config.database);
const sinks = buildSinks(config);

let running = false;
async function cycle() {
  if (running) {
    log.warn("previous sync still running, skipping this cycle");
    return;
  }
  running = true;
  try {
    await runSync(config, store, sinks);
  } catch (err) {
    log.error(`sync cycle failed: ${(err as Error).message}`);
  } finally {
    running = false;
  }
}

if (process.argv.includes("--once")) {
  await cycle();
  store.close();
} else {
  log.info(
    `wisharr started — syncing every ${config.sync.intervalMinutes} min to: ${sinks.map((s) => s.name).join(", ")}`,
  );
  await cycle();
  new Cron(`*/${config.sync.intervalMinutes} * * * *`, cycle);
}
