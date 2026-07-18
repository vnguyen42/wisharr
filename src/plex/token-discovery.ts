import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { log } from "../logger.js";
import { PLEX_TV, plexHeaders } from "./client.js";

const exec = promisify(execFile);

interface Discovered {
  token: string;
  source: string;
}

/** macOS: Plex Media Server stores its preferences in a plist, not Preferences.xml. */
async function fromMacDefaults(): Promise<Discovered | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await exec("defaults", [
      "read",
      "com.plexapp.plexmediaserver",
      "PlexOnlineToken",
    ]);
    const token = stdout.trim();
    return token ? { token, source: "macOS Plex Media Server preferences" } : null;
  } catch {
    return null;
  }
}

/** Linux packages, Docker images and custom installs: Preferences.xml. */
function fromPreferencesXml(): Discovered | null {
  const supportDir = process.env.PLEX_MEDIA_SERVER_APPLICATION_SUPPORT_DIR;
  const candidates = [
    supportDir && `${supportDir}/Plex Media Server/Preferences.xml`,
    "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Preferences.xml",
    "/config/Library/Application Support/Plex Media Server/Preferences.xml",
    `${homedir()}/Library/Application Support/Plex Media Server/Preferences.xml`,
  ].filter((p): p is string => Boolean(p));

  const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const token = xml.parse(readFileSync(path, "utf8"))?.Preferences?.PlexOnlineToken;
      if (token) return { token: String(token), source: path };
    } catch {
      // unreadable or malformed — try the next candidate
    }
  }
  return null;
}

async function fromWindowsRegistry(): Promise<Discovered | null> {
  if (process.platform !== "win32") return null;
  try {
    const { stdout } = await exec("reg", [
      "query",
      "HKCU\\Software\\Plex, Inc.\\Plex Media Server",
      "/v",
      "PlexOnlineToken",
    ]);
    const token = stdout.match(/PlexOnlineToken\s+REG_SZ\s+(\S+)/)?.[1];
    return token ? { token, source: "Windows registry" } : null;
  } catch {
    return null;
  }
}

async function isValid(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${PLEX_TV}/api/v2/ping`, { headers: plexHeaders(token) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Try to find the admin token on the machine Wisharr runs on, so users with a
 * local Plex Media Server never have to hunt for it. Every candidate is
 * validated against plex.tv before being accepted; a stale token is skipped
 * with a warning rather than used blindly.
 */
export async function discoverPlexToken(): Promise<string> {
  const candidates = [await fromMacDefaults(), fromPreferencesXml(), await fromWindowsRegistry()];
  for (const found of candidates) {
    if (!found) continue;
    if (await isValid(found.token)) {
      log.info(`plex token auto-detected from ${found.source}`);
      return found.token;
    }
    log.warn(`plex token found in ${found.source} but rejected by plex.tv, ignoring`);
  }
  throw new Error(
    "no Plex token configured and auto-detection found none — set plex.token in config.yml " +
      "(how to find your token: https://support.plex.tv/articles/204059436)",
  );
}

/** An unexpanded ${VAR} placeholder (env var not set) counts as "not configured". */
export function isConfiguredToken(raw: string): boolean {
  return Boolean(raw) && !/^\$\{[A-Z0-9_]+\}$/.test(raw);
}

/** Use the configured token when present, otherwise fall back to auto-detection. */
export async function resolvePlexToken(configured: string): Promise<string> {
  if (isConfiguredToken(configured)) return configured;
  return discoverPlexToken();
}
