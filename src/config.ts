import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

const radarrSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().min(1),
  qualityProfileId: z.number().int().positive(),
  rootFolderPath: z.string().min(1),
  monitor: z.boolean().default(true),
  searchOnAdd: z.boolean().default(true),
  minimumAvailability: z.enum(["announced", "inCinemas", "released"]).default("released"),
});

const sonarrSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().min(1),
  qualityProfileId: z.number().int().positive(),
  rootFolderPath: z.string().min(1),
  monitor: z.boolean().default(true),
  searchOnAdd: z.boolean().default(true),
  seasonFolder: z.boolean().default(true),
});

const overseerrSchema = z.object({
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
});

export type Config = z.infer<typeof configSchema>;
export type RadarrConfig = z.infer<typeof radarrSchema>;
export type SonarrConfig = z.infer<typeof sonarrSchema>;
export type OverseerrConfig = z.infer<typeof overseerrSchema>;

/** Substitute ${ENV_VAR} references so secrets can stay out of the YAML file. */
function expandEnv(raw: string): string {
  return raw.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => process.env[name] ?? match);
}

export function loadConfig(path = process.env.WISHARR_CONFIG ?? "config/config.yml"): Config {
  const raw = expandEnv(readFileSync(path, "utf8"));
  return configSchema.parse(parse(raw));
}
