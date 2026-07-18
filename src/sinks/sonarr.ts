import type { SonarrConfig } from "../config.js";
import { log } from "../logger.js";
import type { WatchlistItem } from "../plex/watchlist.js";
import type { PushResult, Sink } from "./sink.js";

export class SonarrSink implements Sink {
  readonly name = "sonarr";

  constructor(private readonly cfg: SonarrConfig) {}

  async push(item: WatchlistItem, user: string): Promise<PushResult> {
    if (item.type !== "show") return "skipped";
    if (!item.tvdbId) {
      log.warn(`sonarr: no tvdbId for "${item.title}", skipping`);
      return "skipped";
    }

    const res = await this.api("POST", "/api/v3/series", {
      tvdbId: item.tvdbId,
      title: item.title,
      qualityProfileId: this.cfg.qualityProfileId,
      rootFolderPath: this.cfg.rootFolderPath,
      monitored: this.cfg.monitor,
      seasonFolder: this.cfg.seasonFolder,
      addOptions: {
        searchForMissingEpisodes: this.cfg.searchOnAdd,
        monitor: this.cfg.monitor ? "all" : "none",
      },
      tags: [],
    });

    if (res.ok) return "added";
    const body = await res.text();
    // Sonarr rejects duplicates with a SeriesExistsValidator failure.
    if (res.status === 400 && body.includes("SeriesExistsValidator")) return "already-present";
    throw new Error(`sonarr add failed (${res.status}) for "${item.title}" [${user}]: ${body}`);
  }

  private api(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.cfg.url}${path}`, {
      method,
      headers: { "X-Api-Key": this.cfg.apiKey, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}
