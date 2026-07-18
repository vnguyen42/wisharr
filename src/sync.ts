import type { Config } from "./config.js";
import { log } from "./logger.js";
import { PlexApiError } from "./plex/client.js";
import { type HomeUser, listHomeUsers, switchToHomeUser } from "./plex/home.js";
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

/**
 * Get a working token for the user and fetch their watchlist. Minted tokens
 * are cached in the store — plex.tv rate-limits the switch endpoint, so
 * re-minting every cycle gets throttled fast. A cached token is only replaced
 * when plex.tv rejects it (401/403).
 */
async function fetchWatchlistAs(
  config: Config,
  store: Store,
  user: HomeUser,
): Promise<{ token: string; items: Awaited<ReturnType<typeof fetchWatchlist>> }> {
  if (user.admin) {
    return { token: config.plex.token, items: await fetchWatchlist(config.plex.token) };
  }

  const mint = async () => {
    const token = await switchToHomeUser(config.plex.token, user, config.plex.pins[user.title]);
    store.saveToken(user.id, user.title, token);
    return token;
  };

  const cached = store.getToken(user.id);
  const token = cached ?? (await mint());
  try {
    return { token, items: await fetchWatchlist(token) };
  } catch (err) {
    const expired =
      cached && err instanceof PlexApiError && (err.status === 401 || err.status === 403);
    if (!expired) throw err;
    log.info(`cached token for "${user.title}" expired, minting a fresh one`);
    store.deleteToken(user.id);
    const fresh = await mint();
    return { token: fresh, items: await fetchWatchlist(fresh) };
  }
}

export interface SyncOptions {
  /**
   * Seed mode: mark every current watchlist item as already synced without
   * pushing anything. Run once on a fresh install so only items added from
   * now on generate requests, instead of blasting the whole backlog.
   */
  seed?: boolean;
}

/** One full cycle: enumerate Home profiles, mint tokens, fetch watchlists, push. */
export async function runSync(
  config: Config,
  store: Store,
  sinks: Sink[],
  opts: SyncOptions = {},
): Promise<void> {
  const users = await listHomeUsers(config.plex.token);
  log.info(`found ${users.length} Plex Home profile(s)`);

  for (const user of users) {
    if (config.plex.excludeUsers.includes(user.title)) continue;
    if (user.admin && !config.sync.includeOwner) continue;

    let fetched;
    try {
      fetched = await fetchWatchlistAs(config, store, user);
    } catch (err) {
      if (err instanceof PlexApiError && err.status === 429) {
        log.warn(`plex.tv rate limit while syncing "${user.title}", will retry next cycle`);
      } else {
        log.error(`cannot fetch watchlist for "${user.title}": ${(err as Error).message}`);
      }
      continue;
    }
    const { token, items } = fetched;
    log.info(`"${user.title}": ${items.length} watchlist item(s)`);

    let seeded = 0;
    for (const rawItem of items) {
      const pending = sinks.filter((s) => !store.isSynced(user.title, rawItem.guid, s.name));
      if (pending.length === 0) continue;

      if (opts.seed) {
        for (const sink of pending) {
          store.markSynced(user.title, rawItem.guid, sink.name, rawItem.title);
        }
        seeded++;
        continue;
      }

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
    if (opts.seed && seeded > 0) {
      log.info(`"${user.title}": seeded ${seeded} item(s) as already synced`);
    }
  }
}
