import { asArray, DISCOVER, plexJson } from "./client.js";

export interface WatchlistItem {
  /** plex:// GUID — stable identity used for dedup. */
  guid: string;
  ratingKey: string;
  type: "movie" | "show";
  title: string;
  year?: number;
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
}

interface DiscoverMetadata {
  guid: string;
  ratingKey: string;
  type: string;
  title: string;
  year?: number;
  Guid?: { id: string }[];
}

interface DiscoverContainer {
  MediaContainer?: { Metadata?: DiscoverMetadata | DiscoverMetadata[] };
}

/** Fetch a user's complete watchlist from Plex Discover using their (minted) token. */
export async function fetchWatchlist(userToken: string): Promise<WatchlistItem[]> {
  const items: WatchlistItem[] = [];
  const pageSize = 100;

  for (let start = 0; ; start += pageSize) {
    const url =
      `${DISCOVER}/library/sections/watchlist/all` +
      `?includeExternalMedia=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`;
    const page = await plexJson<DiscoverContainer>(url, userToken);
    const metadata = asArray(page.MediaContainer?.Metadata);
    if (metadata.length === 0) break;

    for (const m of metadata) {
      if (m.type !== "movie" && m.type !== "show") continue;
      items.push({
        guid: m.guid,
        ratingKey: m.ratingKey,
        type: m.type,
        title: m.title,
        year: m.year,
        ...parseExternalGuids(m.Guid),
      });
    }
    if (metadata.length < pageSize) break;
  }
  return items;
}

/**
 * The watchlist listing usually omits external IDs — resolve them from the
 * Discover metadata endpoint (tmdb/tvdb/imdb Guid entries).
 */
export async function resolveExternalIds(
  userToken: string,
  item: WatchlistItem,
): Promise<WatchlistItem> {
  if (item.tmdbId || item.tvdbId) return item;
  const url = `${DISCOVER}/library/metadata/${item.ratingKey}`;
  const doc = await plexJson<DiscoverContainer>(url, userToken);
  const metadata = asArray(doc.MediaContainer?.Metadata)[0];
  return { ...item, ...parseExternalGuids(metadata?.Guid) };
}

function parseExternalGuids(guids?: { id: string }[]): Partial<WatchlistItem> {
  const out: Partial<WatchlistItem> = {};
  for (const g of guids ?? []) {
    const [scheme, value] = g.id.split("://");
    if (scheme === "tmdb") out.tmdbId = Number(value);
    else if (scheme === "tvdb") out.tvdbId = Number(value);
    else if (scheme === "imdb") out.imdbId = value;
  }
  return out;
}
