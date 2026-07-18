import { readFileSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { z } from "zod";

/** The subset of the config the web UI is allowed to change. */
export const configUpdateSchema = z.object({
  sync: z
    .object({
      intervalMinutes: z.number().int().min(1).max(1440).optional(),
      includeOwner: z.boolean().optional(),
      seedOnFirstRun: z.boolean().optional(),
    })
    .optional(),
  plex: z
    .object({
      excludeUsers: z.array(z.string()).optional(),
    })
    .optional(),
});

export type ConfigUpdate = z.infer<typeof configUpdateSchema>;

/**
 * Apply an update to config.yml in place, preserving comments and ${ENV_VAR}
 * placeholders — only the exact paths being changed are touched.
 */
export function updateConfigFile(path: string, update: ConfigUpdate): void {
  const doc = parseDocument(readFileSync(path, "utf8"));

  const entries: [string[], unknown][] = [
    [["sync", "intervalMinutes"], update.sync?.intervalMinutes],
    [["sync", "includeOwner"], update.sync?.includeOwner],
    [["sync", "seedOnFirstRun"], update.sync?.seedOnFirstRun],
    [["plex", "excludeUsers"], update.plex?.excludeUsers],
  ];
  for (const [keyPath, value] of entries) {
    if (value !== undefined) doc.setIn(keyPath, value);
  }

  writeFileSync(path, doc.toString());
}
