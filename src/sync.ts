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
   * Force seed mode for every sink: mark every current watchlist item as
   * already synced without pushing anything (`npm run seed`).
   */
  seed?: boolean;
}

/**
 * Sinks whose backlog should be absorbed silently this cycle: all of them when
 * seeding is forced, otherwise — with seedOnFirstRun — any sink that has never
 * been synced to (fresh install, or a sink newly added to the config).
 */
function sinksToSeed(config: Config, store: Store, sinks: Sink[], opts: SyncOptions): Set<string> {
  if (opts.seed) return new Set(sinks.map((s) => s.name));
  if (!config.sync.seedOnFirstRun) return new Set();
  return new Set(sinks.filter((s) => !store.sinkKnown(s.name)).map((s) => s.name));
}

export interface UserReport {
  plexId: number;
  title: string;
  admin: boolean;
  managed: boolean;
  guest: boolean;
  protected: boolean;
  excluded: boolean;
  /** null when the watchlist could not be fetched (see error). */
  items: number | null;
  seeded: number;
  added: { title: string; sink: string }[];
  error?: string;
}

export interface CycleReport {
  startedAt: string;
  durationMs: number;
  seedMode: boolean;
  users: UserReport[];
}

/** One full cycle: enumerate Home profiles, mint tokens, fetch watchlists, push. */
export async function runSync(
  config: Config,
  store: Store,
  sinks: Sink[],
  opts: SyncOptions = {},
): Promise<CycleReport> {
  const startedAt = new Date();
  const report: CycleReport = {
    startedAt: startedAt.toISOString(),
    durationMs: 0,
    seedMode: opts.seed ?? false,
    users: [],
  };
  const seedSinks = sinksToSeed(config, store, sinks, opts);
  if (seedSinks.size > 0 && !opts.seed) {
    log.info(
      `first sync for sink(s) ${[...seedSinks].join(", ")}: absorbing the existing backlog ` +
        `without pushing (disable with sync.seedOnFirstRun: false)`,
    );
  }

  const users = await listHomeUsers(config.plex.token);
  log.info(`found ${users.length} Plex Home profile(s)`);

  for (const user of users) {
    const userReport: UserReport = {
      plexId: user.id,
      title: user.title,
      admin: user.admin,
      managed: user.restricted,
      guest: user.guest,
      protected: user.protected,
      excluded:
        config.plex.excludeUsers.includes(user.title) ||
        (user.admin && !config.sync.includeOwner),
      items: null,
      seeded: 0,
      added: [],
    };
    report.users.push(userReport);
    if (userReport.excluded) continue;

    let fetched;
    try {
      fetched = await fetchWatchlistAs(config, store, user);
    } catch (err) {
      userReport.error = (err as Error).message;
      if (err instanceof PlexApiError && err.status === 429) {
        log.warn(`plex.tv rate limit while syncing "${user.title}", will retry next cycle`);
      } else {
        log.error(`cannot fetch watchlist for "${user.title}": ${(err as Error).message}`);
      }
      continue;
    }
    const { token, items } = fetched;
    userReport.items = items.length;
    log.info(`"${user.title}": ${items.length} watchlist item(s)`);

    let seeded = 0;
    for (const rawItem of items) {
      const pending = sinks.filter((s) => !store.isSynced(user.title, rawItem.guid, s.name));
      const toSeed = pending.filter((s) => seedSinks.has(s.name));
      const toPush = pending.filter((s) => !seedSinks.has(s.name));

      if (toSeed.length > 0) {
        for (const sink of toSeed) {
          store.markSynced(user.title, rawItem.guid, sink.name, rawItem.title, true);
        }
        seeded++;
      }
      if (toPush.length === 0) continue;

      let item = rawItem;
      try {
        item = await resolveExternalIds(token, rawItem);
      } catch (err) {
        log.warn(`cannot resolve IDs for "${rawItem.title}": ${(err as Error).message}`);
      }

      for (const sink of toPush) {
        try {
          const result = await sink.push(item, { plexId: user.id, title: user.title });
          if (result !== "skipped") {
            store.markSynced(user.title, item.guid, sink.name, item.title);
          }
          if (result === "added") {
            userReport.added.push({ title: item.title, sink: sink.name });
            log.info(`${sink.name}: added "${item.title}" (from ${user.title})`);
          }
        } catch (err) {
          log.error((err as Error).message);
        }
      }
    }
    userReport.seeded = seeded;
    if (seeded > 0) {
      log.info(`"${user.title}": seeded ${seeded} item(s) as already synced`);
    }
  }

  report.durationMs = Date.now() - startedAt.getTime();
  return report;
}
