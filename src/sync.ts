import type { Config } from "./config.js";
import { log } from "./logger.js";
import { PlexApiError } from "./plex/client.js";
import { fetchFriendWatchlist, listFriends } from "./plex/friends.js";
import { type HomeUser, listHomeUsers, switchToHomeUser } from "./plex/home.js";
import { fetchWatchlist, resolveExternalIds, type WatchlistItem } from "./plex/watchlist.js";
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
  /** null for friends: the community API only exposes a uuid. */
  plexId: number | null;
  title: string;
  admin: boolean;
  managed: boolean;
  guest: boolean;
  friend: boolean;
  protected: boolean;
  excluded: boolean;
  /** null when the watchlist could not be fetched (see error). */
  items: number | null;
  seeded: number;
  added: { title: string; sink: string }[];
  removed: { title: string; sink: string }[];
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

  /** Watchlists successfully fetched this cycle, for the removal pass. */
  const fetchedWatchlists: { title: string; guids: Set<string> }[] = [];

  async function processUser(
    userReport: UserReport,
    fetchItems: () => Promise<{ token: string; items: WatchlistItem[] }>,
  ): Promise<void> {
    report.users.push(userReport);
    if (userReport.excluded) return;

    let fetched;
    try {
      fetched = await fetchItems();
    } catch (err) {
      userReport.error = (err as Error).message;
      if (err instanceof PlexApiError && err.status === 429) {
        log.warn(`plex.tv rate limit while syncing "${userReport.title}", will retry next cycle`);
      } else if (userReport.friend) {
        // Expected for friends whose watchlist visibility is private.
        log.debug(`cannot fetch friend watchlist "${userReport.title}": ${(err as Error).message}`);
      } else {
        log.error(`cannot fetch watchlist for "${userReport.title}": ${(err as Error).message}`);
      }
      return;
    }
    const { token, items } = fetched;
    userReport.items = items.length;
    log.info(`"${userReport.title}": ${items.length} watchlist item(s)`);

    // A user never processed before (new profile, new friend) has their
    // backlog absorbed silently, exactly like a newly added sink.
    const firstSeen =
      !opts.seed && config.sync.seedOnFirstRun && !store.isSeen(userReport.title);
    const seedAll = (opts.seed ?? false) || firstSeen;

    let seeded = 0;
    for (const rawItem of items) {
      const pending = sinks.filter((s) => !store.isSynced(userReport.title, rawItem.guid, s.name));
      const toSeed = pending.filter((s) => seedAll || seedSinks.has(s.name));
      const toPush = pending.filter((s) => !toSeed.includes(s));

      if (toSeed.length > 0) {
        for (const sink of toSeed) {
          store.markSynced(userReport.title, rawItem.guid, sink.name, rawItem.title, true);
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
          const result = await sink.push(item, {
            plexId: userReport.plexId ?? undefined,
            title: userReport.title,
          });
          // Only "added" means Wisharr owns the entry. "already-present"
          // (someone requested it by hand) and "skipped" (the sink can never
          // take this item) are recorded as absorbed so removal sync will
          // never touch them and they aren't retried every cycle.
          store.markSynced(
            userReport.title,
            item.guid,
            sink.name,
            item.title,
            result !== "added",
          );
          if (result === "added") {
            userReport.added.push({ title: item.title, sink: sink.name });
            log.info(`${sink.name}: added "${item.title}" (from ${userReport.title})`);
          }
        } catch (err) {
          log.error((err as Error).message);
        }
      }
    }
    userReport.seeded = seeded;
    if (seeded > 0) {
      log.info(`"${userReport.title}": seeded ${seeded} item(s) as already synced`);
    }
    store.markSeen(userReport.title);
    fetchedWatchlists.push({
      title: userReport.title,
      guids: new Set(items.map((i) => i.guid)),
    });
  }

  const users = await listHomeUsers(config.plex.token);
  log.info(`found ${users.length} Plex Home profile(s)`);

  for (const user of users) {
    await processUser(
      {
        plexId: user.id,
        title: user.title,
        admin: user.admin,
        managed: user.restricted,
        guest: user.guest,
        friend: false,
        protected: user.protected,
        excluded:
          config.plex.excludeUsers.includes(user.title) ||
          (user.admin && !config.sync.includeOwner),
        items: null,
        seeded: 0,
        added: [],
        removed: [],
      },
      () => fetchWatchlistAs(config, store, user),
    );
  }

  if (config.sync.friends) {
    try {
      // Home members can also appear as friends, under their account
      // username. Match on usernames only: matching titles too would silently
      // drop a real friend whose username happens to equal a profile title.
      const homeNames = new Set(
        users.map((u) => u.username.toLowerCase()).filter(Boolean),
      );
      const friends = (await listFriends(config.plex.token)).filter(
        (f) => !homeNames.has(f.username.toLowerCase()),
      );
      if (friends.length > 0) log.info(`found ${friends.length} friend(s) outside the Home`);
      for (const friend of friends) {
        await processUser(
          {
            plexId: null,
            title: friend.username,
            admin: false,
            managed: false,
            guest: false,
            friend: true,
            protected: false,
            excluded: config.plex.excludeUsers.includes(friend.username),
            items: null,
            seeded: 0,
            added: [],
            removed: [],
          },
          async () => ({
            token: config.plex.token,
            items: await fetchFriendWatchlist(config.plex.token, friend),
          }),
        );
      }
    } catch (err) {
      log.warn(`cannot list friends: ${(err as Error).message}`);
    }
  }

  if (config.sync.removal && !opts.seed) {
    await removalPass(config, store, sinks, report, fetchedWatchlists);
  }

  report.durationMs = Date.now() - startedAt.getTime();
  return report;
}

/**
 * Undo pass: items that vanished from a user's watchlist lose their synced
 * rows (so re-adding pushes again), and once no user references an item at
 * all, sinks that Wisharr actually pushed to (never seeded backlog) get a
 * remove call — delete the Overseerr request, unmonitor in Radarr/Sonarr.
 * Only runs over watchlists fetched successfully this cycle, so a transient
 * fetch failure can never masquerade as a mass removal.
 */
export async function removalPass(
  config: Config,
  store: Store,
  sinks: Sink[],
  report: CycleReport,
  fetchedWatchlists: { title: string; guids: Set<string> }[],
): Promise<void> {
  for (const { title: userTitle, guids: current } of fetchedWatchlists) {
    const gone = store.rowsForUser(userTitle).filter((row) => !current.has(row.guid));
    if (gone.length === 0) continue;

    const userReport = report.users.find((u) => u.title === userTitle);
    const byGuid = new Map<string, typeof gone>();
    for (const row of gone) {
      byGuid.set(row.guid, [...(byGuid.get(row.guid) ?? []), row]);
    }

    for (const [guid, rows] of byGuid) {
      log.info(`"${rows[0]!.title}" left ${userTitle}'s watchlist`);

      const pushedSinks = new Set(rows.filter((r) => !r.seeded).map((r) => r.sink));
      const stillWanted = store.guidTrackedByOthers(guid, userTitle);
      if (stillWanted || pushedSinks.size === 0) {
        // Someone else still has it, or Wisharr never added it — just forget
        // this user's rows so a future re-add pushes again.
        store.deleteSynced(userTitle, guid);
        continue;
      }

      const [, type, ratingKey] = guid.match(/^plex:\/\/(movie|show)\/(.+)$/) ?? [];
      if (!type || !ratingKey) {
        store.deleteSynced(userTitle, guid);
        continue;
      }
      let item: WatchlistItem = {
        guid,
        ratingKey,
        type: type as "movie" | "show",
        title: rows[0]!.title,
      };
      try {
        item = await resolveExternalIds(config.plex.token, item);
      } catch (err) {
        log.warn(`removal: cannot resolve IDs for "${item.title}": ${(err as Error).message}`);
      }

      // Rows are only deleted once every sink removal succeeded — a sink that
      // is briefly down keeps its rows and the removal is retried next cycle.
      let allSucceeded = true;
      for (const sink of sinks) {
        if (!pushedSinks.has(sink.name) || !sink.remove) continue;
        try {
          const result = await sink.remove(item);
          if (result === "removed") {
            userReport?.removed.push({ title: item.title, sink: sink.name });
            log.info(`${sink.name}: removed "${item.title}" (no watchlist references it anymore)`);
          }
        } catch (err) {
          allSucceeded = false;
          log.error(`removal failed in ${sink.name} for "${item.title}": ${(err as Error).message}`);
        }
      }
      if (allSucceeded) store.deleteSynced(userTitle, guid);
    }
  }
}
