import type { RadarrConfig } from "../config.js";
import { log } from "../logger.js";
import type { WatchlistItem } from "../plex/watchlist.js";
import type { PushResult, RemoveResult, Requester, Sink } from "./sink.js";

export class RadarrSink implements Sink {
  readonly name = "radarr";

  constructor(private readonly cfg: RadarrConfig) {}

  async push(item: WatchlistItem, requester: Requester): Promise<PushResult> {
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
    throw new Error(
      `radarr add failed (${res.status}) for "${item.title}" [${requester.title}]: ${body}`,
    );
  }

  /** Unmonitor only — files and the movie entry itself are never deleted. */
  async remove(item: WatchlistItem): Promise<RemoveResult> {
    if (item.type !== "movie" || !item.tmdbId) return "skipped";
    const res = await this.api("GET", `/api/v3/movie?tmdbId=${item.tmdbId}`);
    if (!res.ok) throw new Error(`radarr lookup failed (${res.status})`);
    const [movie] = (await res.json()) as ({ id: number; monitored: boolean } & object)[];
    if (!movie || !movie.monitored) return "skipped";
    const put = await this.api("PUT", `/api/v3/movie/${movie.id}`, {
      ...movie,
      monitored: false,
    });
    if (!put.ok) throw new Error(`radarr unmonitor failed (${put.status})`);
    return "removed";
  }

  private api(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.cfg.url}${path}`, {
      method,
      headers: { "X-Api-Key": this.cfg.apiKey, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}
