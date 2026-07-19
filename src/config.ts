import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

export const radarrSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().min(1),
  qualityProfileId: z.number().int().positive(),
  rootFolderPath: z.string().min(1),
  monitor: z.boolean().default(true),
  searchOnAdd: z.boolean().default(true),
  minimumAvailability: z.enum(["announced", "inCinemas", "released"]).default("released"),
});

export const sonarrSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().min(1),
  qualityProfileId: z.number().int().positive(),
  rootFolderPath: z.string().min(1),
  monitor: z.boolean().default(true),
  searchOnAdd: z.boolean().default(true),
  seasonFolder: z.boolean().default(true),
  /** Which episodes Sonarr monitors on a newly added series. */
  seasonMonitoring: z
    .enum(["all", "future", "missing", "existing", "pilot", "firstSeason", "latestSeason", "none"])
    .default("all"),
});

export const overseerrSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().min(1),
});

export const configSchema = z.object({
  plex: z.object({
    /**
     * Admin account token — the only long-lived secret Wisharr needs.
     * Optional: when empty, Wisharr tries to auto-detect it from a local
     * Plex Media Server install (see plex/token-discovery.ts).
     */
    token: z.string().default(""),
    /** Managed-user PINs by profile title, for protected Home profiles. */
    pins: z.record(z.string()).default({}),
    /** Home profile titles to skip entirely. */
    excludeUsers: z.array(z.string()).default([]),
  }),
  sync: z
    .object({
      intervalMinutes: z.number().int().min(1).default(20),
      /** Also sync the admin account's own watchlist. */
      includeOwner: z.boolean().default(true),
      /**
       * When a sink or a user is synced for the very first time (fresh
       * install, a sink added later, or a new friend/profile), silently mark
       * their existing watchlist backlog as synced instead of requesting all
       * of it at once. Set to false to push the backlog.
       */
      seedOnFirstRun: z.boolean().default(true),
      /** Also sync watchlists of friends outside the Plex Home (community API). */
      friends: z.boolean().default(true),
      /** Poll Plex Pass RSS feeds between cycles for near-real-time sync. */
      rss: z.boolean().default(true),
      rssIntervalSeconds: z.number().int().min(30).max(3600).default(60),
      /**
       * When an item leaves every watchlist, undo what Wisharr did for it:
       * delete the Overseerr request, unmonitor in Radarr/Sonarr. Only items
       * Wisharr itself pushed are touched — never seeded backlog. Opt-in.
       */
      removal: z.boolean().default(false),
    })
    .default({}),
  sinks: z
    .object({
      overseerr: overseerrSchema.optional(),
      radarr: radarrSchema.optional(),
      sonarr: sonarrSchema.optional(),
    })
    .refine((s) => s.overseerr || s.radarr || s.sonarr, {
      message: "configure at least one sink (overseerr, radarr or sonarr)",
    }),
  database: z.string().default("data/wisharr.db"),
  ui: z
    .object({
      enabled: z.boolean().default(true),
      port: z.number().int().min(1).max(65535).default(9797),
      /** When set, the whole UI and API require HTTP Basic auth. */
      auth: z
        .object({
          username: z.string().min(1),
          password: z.string().min(1),
        })
        .optional(),
    })
    .default({}),
});

export type Config = z.infer<typeof configSchema>;
export type RadarrConfig = z.infer<typeof radarrSchema>;
export type SonarrConfig = z.infer<typeof sonarrSchema>;
export type OverseerrConfig = z.infer<typeof overseerrSchema>;

/** Substitute ${ENV_VAR} references so secrets can stay out of the YAML file. */
function expandEnv(raw: string): string {
  return raw.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => process.env[name] ?? match);
}

export function configPath(): string {
  return process.env.WISHARR_CONFIG ?? "config/config.yml";
}

export function loadConfig(path = configPath()): Config {
  const raw = expandEnv(readFileSync(path, "utf8"));
  return configSchema.parse(parse(raw));
}
