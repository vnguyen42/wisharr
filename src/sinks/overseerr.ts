import type { OverseerrConfig } from "../config.js";
import { log } from "../logger.js";
import type { WatchlistItem } from "../plex/watchlist.js";
import type { PushResult, Requester, Sink } from "./sink.js";

interface OverseerrUser {
  id: number;
  plexId?: number | null;
  plexUsername?: string | null;
  username?: string | null;
  displayName?: string | null;
}

const USER_CACHE_TTL_MS = 10 * 60_000;
const USER_CACHE_MIN_REFRESH_MS = 60_000;

/** Requests items through the Overseerr/Jellyseerr API (POST /api/v1/request). */
export class OverseerrSink implements Sink {
  readonly name = "overseerr";

  /** plexId → Overseerr user id, plus a lowercased-name fallback index. */
  private byPlexId = new Map<number, number>();
  private byName = new Map<string, number>();
  private usersFetchedAt = 0;
  private readonly warnedUnknown = new Set<string>();

  constructor(private readonly cfg: OverseerrConfig) {}

  async push(item: WatchlistItem, requester: Requester): Promise<PushResult> {
    if (!item.tmdbId) {
      log.warn(`overseerr: no tmdbId for "${item.title}", skipping`);
      return "skipped";
    }

    const userId = await this.resolveRequester(requester);
    const res = await fetch(`${this.cfg.url}/api/v1/request`, {
      method: "POST",
      headers: { "X-Api-Key": this.cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaType: item.type === "movie" ? "movie" : "tv",
        mediaId: item.tmdbId,
        ...(item.type === "show" ? { seasons: "all" } : {}),
        // Attribute the request to the matching Overseerr account when there
        // is one; without userId it belongs to the API key owner (admin).
        ...(userId !== undefined ? { userId } : {}),
      }),
    });

    if (res.ok) return "added";

    const body = await res.text();
    // Overseerr answers 409 (or a 500 with this message on older versions)
    // when the media already exists or was already requested.
    if (res.status === 409 || body.includes("already exists")) return "already-present";
    throw new Error(
      `overseerr request failed (${res.status}) for "${item.title}" [${requester.title}]: ${body}`,
    );
  }

  /**
   * Map a Plex Home profile to its Overseerr account. Not every Plex user
   * exists in Overseerr (managed users usually don't) — unmatched requesters
   * return undefined and the request falls back to the admin, with a single
   * informational log per unknown user.
   */
  private async resolveRequester(requester: Requester): Promise<number | undefined> {
    await this.loadUsers();
    let id = this.byPlexId.get(requester.plexId) ?? this.byName.get(requester.title.toLowerCase());

    // Unknown user: maybe they were imported into Overseerr since the last
    // fetch — refresh once (rate-limited) before giving up.
    if (id === undefined && Date.now() - this.usersFetchedAt > USER_CACHE_MIN_REFRESH_MS) {
      await this.loadUsers(true);
      id = this.byPlexId.get(requester.plexId) ?? this.byName.get(requester.title.toLowerCase());
    }

    if (id === undefined && !this.warnedUnknown.has(requester.title)) {
      this.warnedUnknown.add(requester.title);
      log.info(
        `overseerr: no account matches Plex user "${requester.title}", ` +
          `their requests will be attributed to the API key owner`,
      );
    }
    return id;
  }

  private async loadUsers(force = false): Promise<void> {
    const now = Date.now();
    if (!force && this.usersFetchedAt > 0 && now - this.usersFetchedAt < USER_CACHE_TTL_MS) {
      return;
    }

    const byPlexId = new Map<number, number>();
    const byName = new Map<string, number>();
    try {
      const pageSize = 100;
      for (let skip = 0; ; skip += pageSize) {
        const res = await fetch(`${this.cfg.url}/api/v1/user?take=${pageSize}&skip=${skip}`, {
          headers: { "X-Api-Key": this.cfg.apiKey },
        });
        if (!res.ok) throw new Error(`GET /api/v1/user returned ${res.status}`);
        const { results } = (await res.json()) as { results: OverseerrUser[] };

        for (const u of results) {
          if (u.plexId) byPlexId.set(u.plexId, u.id);
          for (const name of [u.plexUsername, u.username, u.displayName]) {
            if (name) byName.set(name.toLowerCase(), u.id);
          }
        }
        if (results.length < pageSize) break;
      }
      this.byPlexId = byPlexId;
      this.byName = byName;
      this.usersFetchedAt = now;
    } catch (err) {
      // Attribution is best-effort: keep the previous (possibly empty) map and
      // let requests fall back to the admin rather than failing the push.
      log.warn(`overseerr: cannot load user list (${(err as Error).message})`);
      this.usersFetchedAt = now;
    }
  }
}
