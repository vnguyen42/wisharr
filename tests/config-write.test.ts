import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { updateConfigFile } from "../src/server/config-write.js";

const SAMPLE = `plex:
  # my token comment
  token: \${PLEX_TOKEN}
  excludeUsers: []

sync:
  # polling interval
  intervalMinutes: 20
  removal: false

sinks:
  overseerr:
    url: http://overseerr:5055
    apiKey: \${OVERSEERR_API_KEY}
`;

function tempConfig(): string {
  const path = join(mkdtempSync(join(tmpdir(), "wisharr-")), "config.yml");
  writeFileSync(path, SAMPLE);
  return path;
}

test("updates touch only the targeted keys, preserving comments and env placeholders", () => {
  const path = tempConfig();
  updateConfigFile(path, { sync: { intervalMinutes: 45 } });

  const raw = readFileSync(path, "utf8");
  assert.match(raw, /# my token comment/);
  assert.match(raw, /# polling interval/);
  assert.match(raw, /token: \$\{PLEX_TOKEN\}/, "secret placeholder must survive");
  assert.match(raw, /apiKey: \$\{OVERSEERR_API_KEY\}/);
  assert.equal(parse(raw).sync.intervalMinutes, 45);
});

test("excludeUsers list writes cleanly, including YAML-hostile names", () => {
  const path = tempConfig();
  const hostile = ['Zouzou', 'name: with colon', '- dash', 'quote"inside'];
  updateConfigFile(path, { plex: { excludeUsers: hostile } });
  assert.deepEqual(parse(readFileSync(path, "utf8")).plex.excludeUsers, hostile);
});

test("a new sink section is created without disturbing existing ones", () => {
  const path = tempConfig();
  updateConfigFile(path, {
    sinks: { radarr: { url: "http://radarr:7878", apiKey: "k", qualityProfileId: 1, rootFolderPath: "/movies" } },
  });
  const parsed = parse(readFileSync(path, "utf8"));
  assert.equal(parsed.sinks.radarr.url, "http://radarr:7878");
  assert.equal(parsed.sinks.overseerr.url, "http://overseerr:5055");
  assert.match(readFileSync(path, "utf8"), /apiKey: \$\{OVERSEERR_API_KEY\}/);
});
