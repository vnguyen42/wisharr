import { XMLParser } from "fast-xml-parser";

export const PLEX_TV = "https://plex.tv";
export const DISCOVER = "https://discover.provider.plex.tv";

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

/**
 * Standard Plex client headers. The client identifier must stay stable across
 * runs, otherwise plex.tv registers a new "device" on every request.
 */
export function plexHeaders(token: string): Record<string, string> {
  return {
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": "wisharr",
    "X-Plex-Product": "Wisharr",
    "X-Plex-Version": "0.1.0",
    "X-Plex-Platform": "Node",
    "X-Plex-Device-Name": "Wisharr",
  };
}

export class PlexApiError extends Error {
  constructor(
    public readonly status: number,
    url: string,
  ) {
    super(`Plex API ${status} on ${url}`);
  }
}

export async function plexJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...plexHeaders(token), Accept: "application/json", ...init?.headers },
  });
  if (!res.ok) throw new PlexApiError(res.status, url);
  return (await res.json()) as T;
}

export async function plexXml(url: string, token: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { ...plexHeaders(token), Accept: "application/xml", ...init?.headers },
  });
  if (!res.ok) throw new PlexApiError(res.status, url);
  return xml.parse(await res.text());
}

/** fast-xml-parser returns an object for a single child and an array for many. */
export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
