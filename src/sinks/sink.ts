import type { WatchlistItem } from "../plex/watchlist.js";

export type PushResult = "added" | "already-present" | "skipped";

/** The Plex user whose watchlist an item came from. */
export interface Requester {
  /**
   * plex.tv account id — stable key for matching against sink-side accounts.
   * Absent for friends synced via the community API (they only expose a uuid).
   */
  plexId?: number;
  /** Display title (or username), used in logs and as a name-based match. */
  title: string;
}

export type RemoveResult = "removed" | "skipped";

export interface Sink {
  /** Stable key: config section, store rows, API routes. Never change it. */
  readonly name: string;
  /** Human-facing product name for logs and the web UI. */
  readonly label: string;
  /** Push one watchlist item; must be idempotent. */
  push(item: WatchlistItem, requester: Requester): Promise<PushResult>;
  /**
   * Undo a previous push after the item left every watchlist: delete the
   * request / unmonitor. Never deletes files. Optional per sink.
   */
  remove?(item: WatchlistItem): Promise<RemoveResult>;
}
