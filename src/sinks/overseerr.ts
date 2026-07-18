import type { OverseerrConfig } from "../config.js";
import { log } from "../logger.js";
import type { WatchlistItem } from "../plex/watchlist.js";
import type { PushResult, Sink } from "./sink.js";

/** Requests items through the Overseerr/Jellyseerr API (POST /api/v1/request). */
export class OverseerrSink implements Sink {
  readonly name = "overseerr";

  constructor(private readonly cfg: OverseerrConfig) {}

  async push(item: WatchlistItem, user: string): Promise<PushResult> {
    if (!item.tmdbId) {
      log.warn(`overseerr: no tmdbId for "${item.title}", skipping`);
      return "skipped";
    }

    const res = await fetch(`${this.cfg.url}/api/v1/request`, {
      method: "POST",
      headers: { "X-Api-Key": this.cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaType: item.type === "movie" ? "movie" : "tv",
        mediaId: item.tmdbId,
        ...(item.type === "show" ? { seasons: "all" } : {}),
      }),
    });

    if (res.ok) return "added";

    const body = await res.text();
    // Overseerr answers 409 (or a 500 with this message on older versions)
    // when the media already exists or was already requested.
    if (res.status === 409 || body.includes("already exists")) return "already-present";
    throw new Error(`overseerr request failed (${res.status}) for "${item.title}" [${user}]: ${body}`);
  }
}
