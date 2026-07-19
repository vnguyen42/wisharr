import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configSchema } from "../src/config.js";
import type { Sink } from "../src/sinks/sink.js";
import { Store } from "../src/store.js";
import { type CycleReport, removalPass } from "../src/sync.js";

const cfg = configSchema.parse({
  plex: { token: "fake-token" },
  sinks: { overseerr: { url: "http://sink.invalid", apiKey: "x" } },
  database: "unused",
});

const freshStore = () => new Store(join(mkdtempSync(join(tmpdir(), "wisharr-")), "test.db"));
const report = (): CycleReport => ({ startedAt: "", durationMs: 0, seedMode: false, users: [] });

const GUID_PUSHED = "plex://movie/aaa1";
const GUID_SEEDED = "plex://movie/bbb2";
const GUID_SHARED = "plex://movie/ccc3";

function seedStore(store: Store) {
  store.markSynced("Alice", GUID_PUSHED, "overseerr", "Pushed Movie", false);
  store.markSynced("Alice", GUID_SEEDED, "overseerr", "Seeded Movie", true);
  store.markSynced("Alice", GUID_SHARED, "overseerr", "Shared Movie", false);
  store.markSynced("Bob", GUID_SHARED, "overseerr", "Shared Movie", true);
}

function fakeSink(behavior: { fail?: boolean }, calls: string[]): Sink {
  return {
    name: "overseerr",
    push: async () => "added",
    remove: async (item) => {
      if (behavior.fail) throw new Error("sink down");
      calls.push(item.title);
      return "removed";
    },
  };
}

test("failed sink removal keeps rows so it retries next cycle", async () => {
  const store = freshStore();
  seedStore(store);
  const calls: string[] = [];
  const behavior = { fail: true };
  const sink = fakeSink(behavior, calls);

  await removalPass(cfg, store, [sink], report(), [{ title: "Alice", guids: new Set() }]);
  assert.ok(
    store.rowsForUser("Alice").some((r) => r.guid === GUID_PUSHED),
    "pushed row must survive a failed removal",
  );
  assert.equal(calls.length, 0);

  behavior.fail = false;
  await removalPass(cfg, store, [sink], report(), [{ title: "Alice", guids: new Set() }]);
  assert.deepEqual(calls, ["Pushed Movie"]);
  assert.equal(store.rowsForUser("Alice").length, 0);
  store.close();
});

test("seeded backlog is forgotten without ever calling remove()", async () => {
  const store = freshStore();
  seedStore(store);
  const calls: string[] = [];

  await removalPass(cfg, store, [fakeSink({}, calls)], report(), [
    { title: "Alice", guids: new Set([GUID_PUSHED, GUID_SHARED]) },
  ]);
  assert.ok(!store.rowsForUser("Alice").some((r) => r.guid === GUID_SEEDED));
  assert.ok(!calls.includes("Seeded Movie"));
  store.close();
});

test("an item still on another user's list is never removed from sinks", async () => {
  const store = freshStore();
  seedStore(store);
  const calls: string[] = [];

  await removalPass(cfg, store, [fakeSink({}, calls)], report(), [
    { title: "Alice", guids: new Set([GUID_PUSHED, GUID_SEEDED]) },
  ]);
  assert.ok(!calls.includes("Shared Movie"), "Bob still tracks it");
  assert.ok(store.rowsForUser("Bob").some((r) => r.guid === GUID_SHARED));
  store.close();
});

test("users whose fetch failed this cycle are untouched", async () => {
  const store = freshStore();
  seedStore(store);
  const calls: string[] = [];

  // Alice is absent from fetchedWatchlists (fetch error) — nothing happens.
  await removalPass(cfg, store, [fakeSink({}, calls)], report(), []);
  assert.equal(store.rowsForUser("Alice").length, 3);
  assert.equal(calls.length, 0);
  store.close();
});
