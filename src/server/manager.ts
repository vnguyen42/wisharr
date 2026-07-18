import { Cron } from "croner";
import type { Config } from "../config.js";
import { log } from "../logger.js";
import type { Sink } from "../sinks/sink.js";
import type { Store } from "../store.js";
import { type CycleReport, runSync } from "../sync.js";

/** Owns the sync loop and its observable state, for both the CLI and the web UI. */
export class SyncManager {
  running = false;
  lastReport: CycleReport | null = null;
  readonly startedAt = new Date().toISOString();
  private cron: Cron | null = null;

  constructor(
    readonly config: Config,
    readonly store: Store,
    readonly sinks: Sink[],
  ) {}

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
  }
}
