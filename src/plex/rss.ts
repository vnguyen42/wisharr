import { randomUUID } from "node:crypto";
import { log } from "../logger.js";
import { DISCOVER, plexHeaders } from "./client.js";

/**
 * Ask plex.tv for the account's watchlist RSS feed URLs (Plex Pass feature).
 * The call is idempotent: it returns the existing feed when one was already
 * generated. Returns [] when the account has no Plex Pass.
 */
export async function ensureRssFeeds(
  token: string,
  includeFriends: boolean,
): Promise<{ feedType: string; url: string }[]> {
  const types = ["watchlist", ...(includeFriends ? ["friendsWatchlist"] : [])];
  const feeds: { feedType: string; url: string }[] = [];

  for (const feedType of types) {
    try {
      const res = await fetch(`${DISCOVER}/rss`, {
        method: "POST",
        headers: {
          ...plexHeaders(token),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ feedType }),
      });
      if (!res.ok) {
        log.warn(`cannot generate ${feedType} RSS feed (HTTP ${res.status}) — Plex Pass required`);
        continue;
      }
      const body = (await res.json()) as { RSSInfo?: { url: string }[] };
      const url = body.RSSInfo?.[0]?.url;
      if (url) feeds.push({ feedType, url });
    } catch (err) {
      log.warn(`cannot generate ${feedType} RSS feed: ${(err as Error).message}`);
    }
  }
  return feeds;
}

/**
 * Fingerprints of the items currently in an RSS feed. Used only to detect
 * "something new appeared" — the actual sync still goes through the full
 * cycle so dedup and per-user attribution stay correct.
 */
export async function fetchRssFingerprints(url: string): Promise<Set<string>> {
  const feedUrl = new URL(url);
  feedUrl.searchParams.set("format", "json");
  feedUrl.searchParams.set("cache_buster", randomUUID().slice(0, 12));

  const res = await fetch(feedUrl);
  if (!res.ok) throw new Error(`RSS feed returned ${res.status}`);
  const body = (await res.json()) as {
    items?: { title?: string; guids?: string[]; pubdate?: string }[];
  };

  const fingerprints = new Set<string>();
  for (const item of body.items ?? []) {
    fingerprints.add(item.guids?.join(",") || item.title || JSON.stringify(item));
  }
  return fingerprints;
}
