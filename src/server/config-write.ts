import { readFileSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { z } from "zod";

const sinkFieldsSchema = z.object({
  url: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  qualityProfileId: z.number().int().positive().optional(),
  rootFolderPath: z.string().min(1).optional(),
  seasonMonitoring: z
    .enum(["all", "future", "missing", "existing", "pilot", "firstSeason", "latestSeason", "none"])
    .optional(),
});

/** The subset of the config the web UI is allowed to change. */
export const configUpdateSchema = z.object({
  sync: z
    .object({
      intervalMinutes: z.number().int().min(1).max(1440).optional(),
      includeOwner: z.boolean().optional(),
      seedOnFirstRun: z.boolean().optional(),
      friends: z.boolean().optional(),
      rss: z.boolean().optional(),
      removal: z.boolean().optional(),
    })
    .optional(),
  plex: z
    .object({
      excludeUsers: z.array(z.string()).optional(),
    })
    .optional(),
  sinks: z
    .object({
      overseerr: sinkFieldsSchema.optional(),
      radarr: sinkFieldsSchema.optional(),
      sonarr: sinkFieldsSchema.optional(),
    })
    .optional(),
});

export type ConfigUpdate = z.infer<typeof configUpdateSchema>;

/**
 * Apply an update to config.yml in place, preserving comments and ${ENV_VAR}
 * placeholders — only the exact paths being changed are touched. A secret the
 * user did not re-enter is never rewritten.
 */
export function updateConfigFile(path: string, update: ConfigUpdate): void {
  const doc = parseDocument(readFileSync(path, "utf8"));

  const entries: [string[], unknown][] = [
    [["sync", "intervalMinutes"], update.sync?.intervalMinutes],
    [["sync", "includeOwner"], update.sync?.includeOwner],
    [["sync", "seedOnFirstRun"], update.sync?.seedOnFirstRun],
    [["sync", "friends"], update.sync?.friends],
    [["sync", "rss"], update.sync?.rss],
    [["sync", "removal"], update.sync?.removal],
    [["plex", "excludeUsers"], update.plex?.excludeUsers],
  ];
  for (const [sinkName, fields] of Object.entries(update.sinks ?? {})) {
    for (const [field, value] of Object.entries(fields ?? {})) {
      entries.push([["sinks", sinkName, field], value]);
    }
  }

  for (const [keyPath, value] of entries) {
    if (value !== undefined) doc.setIn(keyPath, value);
  }

  writeFileSync(path, doc.toString());
}
