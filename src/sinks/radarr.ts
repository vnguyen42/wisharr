import type { RadarrConfig } from "../config.js";
import { log } from "../logger.js";
import type { WatchlistItem } from "../plex/watchlist.js";
import type { PushResult, Sink } from "./sink.js";

export class RadarrSink implements Sink {
  readonly name = "radarr";

  constructor(private readonly cfg: RadarrConfig) {}

  async push(item: WatchlistItem, user: string): Promise<PushResult> {
    if (item.type !== "movie") return "skipped";
    if (!item.tmdbId) {
      log.warn(`radarr: no tmdbId for "${item.title}", skipping`);
      return "skipped";
    }

    const res = await this.api("POST", "/api/v3/movie", {
      tmdbId: item.tmdbId,
      title: item.title,
      year: item.year,
      qualityProfileId: this.cfg.qualityProfileId,
      rootFolderPath: this.cfg.rootFolderPath,
      monitored: this.cfg.monitor,
      minimumAvailability: this.cfg.minimumAvailability,
      addOptions: { searchForMovie: this.cfg.searchOnAdd },
      tags: [],
    });

    if (res.ok) return "added";
    const body = await res.text();
    // Radarr rejects duplicates with a MovieExistsValidator failure.
    if (res.status === 400 && body.includes("MovieExistsValidator")) return "already-present";
    throw new Error(`radarr add failed (${res.status}) for "${item.title}" [${user}]: ${body}`);
  }

  private api(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.cfg.url}${path}`, {
      method,
      headers: { "X-Api-Key": this.cfg.apiKey, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}
