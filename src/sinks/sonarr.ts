import type { SonarrConfig } from "../config.js";
import { log } from "../logger.js";
import type { WatchlistItem } from "../plex/watchlist.js";
import type { PushResult, RemoveResult, Requester, Sink } from "./sink.js";

export class SonarrSink implements Sink {
  readonly name = "sonarr";

  constructor(private readonly cfg: SonarrConfig) {}

  async push(item: WatchlistItem, requester: Requester): Promise<PushResult> {
    if (item.type !== "show") return "skipped";
    if (!item.tvdbId) {
      log.warn(`sonarr: no tvdbId for "${item.title}", skipping`);
      return "skipped";
    }

    const monitoring = this.cfg.monitor ? this.cfg.seasonMonitoring : "none";
    const res = await this.api("POST", "/api/v3/series", {
      tvdbId: item.tvdbId,
      title: item.title,
      qualityProfileId: this.cfg.qualityProfileId,
      rootFolderPath: this.cfg.rootFolderPath,
      monitored: monitoring !== "none",
      seasonFolder: this.cfg.seasonFolder,
      addOptions: {
        searchForMissingEpisodes: this.cfg.searchOnAdd && monitoring !== "none",
        monitor: monitoring,
      },
      tags: [],
    });

    if (res.ok) return "added";
    const body = await res.text();
    // Sonarr rejects duplicates with a SeriesExistsValidator failure.
    if (res.status === 400 && body.includes("SeriesExistsValidator")) return "already-present";
    throw new Error(
      `sonarr add failed (${res.status}) for "${item.title}" [${requester.title}]: ${body}`,
    );
  }

  /** Unmonitor only — files and the series entry itself are never deleted. */
  async remove(item: WatchlistItem): Promise<RemoveResult> {
    if (item.type !== "show" || !item.tvdbId) return "skipped";
    const res = await this.api("GET", `/api/v3/series?tvdbId=${item.tvdbId}`);
    if (!res.ok) throw new Error(`sonarr lookup failed (${res.status})`);
    const [series] = (await res.json()) as ({ id: number; monitored: boolean } & object)[];
    if (!series || !series.monitored) return "skipped";
    const put = await this.api("PUT", `/api/v3/series/${series.id}`, {
      ...series,
      monitored: false,
    });
    if (!put.ok) throw new Error(`sonarr unmonitor failed (${put.status})`);
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
