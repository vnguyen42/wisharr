import { Cron } from "croner";
import type { Config } from "../config.js";
import { log } from "../logger.js";
import { ensureRssFeeds, fetchRssFingerprints } from "../plex/rss.js";
import type { Sink } from "../sinks/sink.js";
import type { Store } from "../store.js";
import { buildSinks, type CycleReport, runSync } from "../sync.js";

/** Owns the sync loop and its observable state, for both the CLI and the web UI. */
export class SyncManager {
  running = false;
  lastReport: CycleReport | null = null;
  readonly startedAt = new Date().toISOString();
  sinks: Sink[];
  private cron: Cron | null = null;

  constructor(
    readonly config: Config,
    readonly store: Store,
  ) {
    this.sinks = buildSinks(config);
  }

  /** Recreate sink instances after a config change from the web UI. */
  rebuildSinks(): void {
    this.sinks = buildSinks(this.config);
  }

  rssState: "off" | "active" | "unavailable" = "off";
  private rssTimer: NodeJS.Timeout | null = null;
  private rssSeen = new Map<string, Set<string>>();

  /**
   * Poll the Plex Pass watchlist RSS feeds between cron cycles. The feeds
   * only say "something new exists" — a full cycle then does the real work,
   * so dedup and per-user attribution stay intact.
   */
  async startRss(): Promise<void> {
    if (!this.config.sync.rss) return;
    const feeds = await ensureRssFeeds(this.config.plex.token, this.config.sync.friends);
    if (feeds.length === 0) {
      this.rssState = "unavailable";
      log.info("real-time RSS sync unavailable (Plex Pass required) — cron cycles only");
      return;
    }
    this.rssState = "active";
    log.info(
      `real-time RSS sync active (${feeds.map((f) => f.feedType).join(", ")}, ` +
        `every ${this.config.sync.rssIntervalSeconds}s)`,
    );

    const poll = async () => {
      let trigger = false;
      for (const feed of feeds) {
        try {
          const current = await fetchRssFingerprints(feed.url);
          const seen = this.rssSeen.get(feed.feedType);
          if (!seen) {
            this.rssSeen.set(feed.feedType, current); // baseline, no trigger
            continue;
          }
          for (const fp of current) {
            if (!seen.has(fp)) {
              seen.add(fp);
              trigger = true;
            }
          }
        } catch (err) {
          log.debug(`RSS poll failed (${feed.feedType}): ${(err as Error).message}`);
        }
      }
      if (trigger && !this.running) {
        log.info("RSS: new watchlist activity detected, starting a sync cycle");
        void this.runCycle();
      }
    };

    await poll();
    this.rssTimer = setInterval(() => void poll(), this.config.sync.rssIntervalSeconds * 1000);
  }

  /** (Re)arm the recurring schedule from the current config. */
  schedule(): void {
    this.cron?.stop();
    this.cron = new Cron(`*/${this.config.sync.intervalMinutes} * * * *`, () => {
      void this.runCycle();
    });
  }

  nextRunAt(): string | null {
    return this.cron?.nextRun()?.toISOString() ?? null;
  }

  /** Run one cycle now; returns false if one was already in flight. */
  async runCycle(seed = false): Promise<boolean> {
    if (this.running) {
      log.warn("previous sync still running, skipping this cycle");
      return false;
    }
    this.running = true;
    try {
      this.lastReport = await runSync(this.config, this.store, this.sinks, { seed });
    } catch (err) {
      log.error(`sync cycle failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return true;
  }

  stop(): void {
    this.cron?.stop();
    if (this.rssTimer) clearInterval(this.rssTimer);
  }
}
