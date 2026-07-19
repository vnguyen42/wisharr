import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/store.js";

const freshStore = () => new Store(join(mkdtempSync(join(tmpdir(), "wisharr-")), "test.db"));

test("markSynced distinguishes pushed items from seeded backlog", () => {
  const store = freshStore();
  store.markSynced("Alice", "plex://movie/a", "overseerr", "A", false);
  store.markSynced("Alice", "plex://movie/b", "overseerr", "B", true);

  const rows = store.rowsForUser("Alice");
  assert.equal(rows.find((r) => r.guid === "plex://movie/a")?.seeded, false);
  assert.equal(rows.find((r) => r.guid === "plex://movie/b")?.seeded, true);
  assert.equal(store.requestCountSince(7), 1, "only the pushed row counts as a request");
  assert.equal(store.trackedItemCount(), 2);
  store.close();
});

test("markSynced is idempotent and never downgrades an existing row", () => {
  const store = freshStore();
  store.markSynced("Alice", "plex://movie/a", "overseerr", "A", false);
  store.markSynced("Alice", "plex://movie/a", "overseerr", "A", true);
  assert.equal(store.rowsForUser("Alice")[0]?.seeded, false, "INSERT OR IGNORE keeps first write");
  store.close();
});

test("sink and user first-run detection", () => {
  const store = freshStore();
  assert.equal(store.sinkKnown("overseerr"), false);
  assert.equal(store.isSeen("Alice"), false);

  store.markSynced("Alice", "plex://movie/a", "overseerr", "A", true);
  store.markSeen("Alice");
  assert.equal(store.sinkKnown("overseerr"), true);
  assert.equal(store.isSeen("Alice"), true);
  assert.equal(store.isSeen("Bob"), false, "a user with zero items must still be markable");
  store.markSeen("Bob");
  assert.equal(store.isSeen("Bob"), true);
  store.close();
});

test("guidTrackedByOthers ignores the removing user's own rows", () => {
  const store = freshStore();
  store.markSynced("Alice", "plex://movie/a", "overseerr", "A", false);
  assert.equal(store.guidTrackedByOthers("plex://movie/a", "Alice"), false);

  store.markSynced("Bob", "plex://movie/a", "overseerr", "A", true);
  assert.equal(store.guidTrackedByOthers("plex://movie/a", "Alice"), true);
  store.close();
});

test("token cache round-trip", () => {
  const store = freshStore();
  assert.equal(store.getToken(42), undefined);
  store.saveToken(42, "Kid", "tok-1");
  assert.equal(store.getToken(42), "tok-1");
  store.saveToken(42, "Kid", "tok-2");
  assert.equal(store.getToken(42), "tok-2", "upsert replaces the token");
  store.deleteToken(42);
  assert.equal(store.getToken(42), undefined);
  store.close();
});
