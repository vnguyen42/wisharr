import { asArray, PLEX_TV, plexXml } from "./client.js";
import { log } from "../logger.js";

export interface HomeUser {
  id: number;
  uuid: string;
  title: string;
  admin: boolean;
  restricted: boolean;
  protected: boolean;
}

/** List every profile in the Plex Home, admin included. Needs only the admin token. */
export async function listHomeUsers(adminToken: string): Promise<HomeUser[]> {
  const doc = await plexXml(`${PLEX_TV}/api/home/users`, adminToken);
  return asArray<any>(doc?.MediaContainer?.User).map((u) => ({
    id: Number(u.id),
    uuid: String(u.uuid ?? ""),
    title: String(u.title),
    admin: u.admin === "1",
    restricted: u.restricted === "1",
    protected: u.protected === "1",
  }));
}

/**
 * Mint a fresh plex.tv token scoped to a managed user, derived from the admin
 * token — the same call Plex's own clients make when switching profiles
 * (POST /api/home/users/{id}/switch). Callers should cache the result and
 * only re-mint on 401/403: plex.tv rate-limits this endpoint (429).
 */
export async function switchToHomeUser(
  adminToken: string,
  user: HomeUser,
  pin?: string,
): Promise<string> {
  const url = new URL(`${PLEX_TV}/api/home/users/${user.id}/switch`);
  if (pin) url.searchParams.set("pin", pin);

  const doc = await plexXml(url.toString(), adminToken, { method: "POST" });
  const token = doc?.user?.authenticationToken ?? doc?.user?.authToken;
  if (!token) {
    throw new Error(`switch to "${user.title}" returned no authenticationToken`);
  }
  log.debug(`minted token for home user "${user.title}"`);
  return String(token);
}
