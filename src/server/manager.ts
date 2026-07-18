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
  private timer: NodeJS.Timeout | null = null;
  private nextAt: number | null = null;

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
  private rssPending = false;

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
      if (trigger) {
        if (this.running) {
          // Don't drop the event: the running cycle may have started before
          // this item appeared — re-run as soon as it finishes.
          this.rssPending = true;
        } else {
          log.info("RSS: new watchlist activity detected, starting a sync cycle");
          void this.runCycle();
        }
      }
    };

    await poll();
    this.rssTimer = setInterval(() => void poll(), this.config.sync.rssIntervalSeconds * 1000);
  }

  /**
   * (Re)arm the recurring schedule from the current config. A plain interval,
   * not a cron pattern: `*​/90 * * * *` would mean "minutes divisible by 90"
   * (i.e. hourly), silently breaking any interval above 59.
   */
  schedule(): void {
    if (this.timer) clearInterval(this.timer);
    const ms = this.config.sync.intervalMinutes * 60_000;
    this.nextAt = Date.now() + ms;
    this.timer = setInterval(() => {
      this.nextAt = Date.now() + ms;
      void this.runCycle();
    }, ms);
  }

  nextRunAt(): string | null {
    return this.nextAt ? new Date(this.nextAt).toISOString() : null;
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
    if (this.rssPending) {
      this.rssPending = false;
      log.info("RSS: activity arrived during the last cycle, running another");
      setTimeout(() => void this.runCycle(), 1_000);
    }
    return true;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.rssTimer) clearInterval(this.rssTimer);
  }
}
