import type { WatchlistItem } from "../plex/watchlist.js";

export type PushResult = "added" | "already-present" | "skipped";

export interface Sink {
  readonly name: string;
  /** Push one watchlist item; must be idempotent. `user` is the Home profile title. */
  push(item: WatchlistItem, user: string): Promise<PushResult>;
}
