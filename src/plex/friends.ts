import { plexHeaders } from "./client.js";
import type { WatchlistItem } from "./watchlist.js";

const COMMUNITY = "https://community.plex.tv/api";

export interface Friend {
  uuid: string;
  username: string;
}

async function gql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(COMMUNITY, {
    method: "POST",
    headers: { ...plexHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`community.plex.tv returned ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  if (!body.data) throw new Error("empty GraphQL response");
  return body.data;
}

/** Friends of the admin account — people outside the Plex Home. */
export async function listFriends(token: string): Promise<Friend[]> {
  const data = await gql<{ allFriendsV2: { user: { id: string; username: string } }[] }>(
    token,
    `query GetAllFriends {
      allFriendsV2 {
        user { id username }
      }
    }`,
  );
  return data.allFriendsV2.map((f) => ({ uuid: f.user.id, username: f.user.username }));
}

interface WatchlistPage {
  user: {
    watchlist: {
      nodes: { id: string; title: string; type: string }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    } | null;
  } | null;
}

/**
 * A friend's watchlist through the community API — works with the admin token
 * alone, but only when the friend's watchlist visibility allows friends.
 * Item ids are Plex metadata ids, so the canonical guid is reconstructable
 * and external IDs resolve through the regular Discover metadata endpoint.
 */
export async function fetchFriendWatchlist(
  token: string,
  friend: Friend,
): Promise<WatchlistItem[]> {
  const items: WatchlistItem[] = [];
  let after: string | null = null;

  for (;;) {
    const data: WatchlistPage = await gql<WatchlistPage>(
      token,
      `query GetWatchlistHub($uuid: ID = "", $first: PaginationInt!, $after: String) {
        user(id: $uuid) {
          watchlist(first: $first, after: $after) {
            nodes { id title type }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { uuid: friend.uuid, first: 100, ...(after ? { after } : {}) },
    );
    const watchlist = data.user?.watchlist;
    if (!watchlist) return items;

    for (const node of watchlist.nodes) {
      const type = node.type === "MOVIE" ? "movie" : node.type === "SHOW" ? "show" : null;
      if (!type) continue;
      items.push({
        guid: `plex://${type}/${node.id}`,
        ratingKey: node.id,
        type,
        title: node.title,
      });
    }
    if (!watchlist.pageInfo.hasNextPage || !watchlist.pageInfo.endCursor) return items;
    after = watchlist.pageInfo.endCursor;
  }
}
