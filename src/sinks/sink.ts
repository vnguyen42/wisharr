import type { WatchlistItem } from "../plex/watchlist.js";

export type PushResult = "added" | "already-present" | "skipped";

/** The Plex Home profile whose watchlist an item came from. */
export interface Requester {
  /** plex.tv account id — stable key for matching against sink-side accounts. */
  plexId: number;
  /** Profile display title, used in logs and as a name-based fallback match. */
  title: string;
}

export interface Sink {
  readonly name: string;
  /** Push one watchlist item; must be idempotent. */
  push(item: WatchlistItem, requester: Requester): Promise<PushResult>;
}
