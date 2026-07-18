import type { Config } from "./config.js";
import { log } from "./logger.js";
import { listHomeUsers, switchToHomeUser } from "./plex/home.js";
import { fetchWatchlist, resolveExternalIds } from "./plex/watchlist.js";
import { OverseerrSink } from "./sinks/overseerr.js";
import { RadarrSink } from "./sinks/radarr.js";
import type { Sink } from "./sinks/sink.js";
import { SonarrSink } from "./sinks/sonarr.js";
import type { Store } from "./store.js";

export function buildSinks(config: Config): Sink[] {
  const sinks: Sink[] = [];
  if (config.sinks.overseerr) sinks.push(new OverseerrSink(config.sinks.overseerr));
  if (config.sinks.radarr) sinks.push(new RadarrSink(config.sinks.radarr));
  if (config.sinks.sonarr) sinks.push(new SonarrSink(config.sinks.sonarr));
  return sinks;
}

/** One full cycle: enumerate Home profiles, mint tokens, fetch watchlists, push. */
export async function runSync(config: Config, store: Store, sinks: Sink[]): Promise<void> {
  const users = await listHomeUsers(config.plex.token);
  log.info(`found ${users.length} Plex Home profile(s)`);

  for (const user of users) {
    if (config.plex.excludeUsers.includes(user.title)) continue;
    if (user.admin && !config.sync.includeOwner) continue;

    let token: string;
    try {
      // Admin already holds a valid token; managed users get one minted on the fly.
      token = user.admin
        ? config.plex.token
        : await switchToHomeUser(config.plex.token, user, config.plex.pins[user.title]);
    } catch (err) {
      log.error(`cannot get token for "${user.title}": ${(err as Error).message}`);
      continue;
    }

    let items;
    try {
      items = await fetchWatchlist(token);
    } catch (err) {
      log.error(`cannot fetch watchlist for "${user.title}": ${(err as Error).message}`);
      continue;
    }
    log.info(`"${user.title}": ${items.length} watchlist item(s)`);

    for (const rawItem of items) {
      const pending = sinks.filter((s) => !store.isSynced(user.title, rawItem.guid, s.name));
      if (pending.length === 0) continue;

      let item = rawItem;
      try {
        item = await resolveExternalIds(token, rawItem);
      } catch (err) {
        log.warn(`cannot resolve IDs for "${rawItem.title}": ${(err as Error).message}`);
      }

      for (const sink of pending) {
        try {
          const result = await sink.push(item, user.title);
          if (result !== "skipped") {
            store.markSynced(user.title, item.guid, sink.name, item.title);
          }
          if (result === "added") {
            log.info(`${sink.name}: added "${item.title}" (from ${user.title})`);
          }
        } catch (err) {
          log.error((err as Error).message);
        }
      }
    }
  }
}
