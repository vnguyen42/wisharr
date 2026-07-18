import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Dedup state: remembers which (user, item, sink) triples were already pushed,
 * so restarting the container never re-requests the whole watchlist.
 * Uses Node's built-in sqlite (Node >= 23.4) — no native dependency to compile.
 */
export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS synced (
        user_title TEXT NOT NULL,
        guid       TEXT NOT NULL,
        sink       TEXT NOT NULL,
        title      TEXT NOT NULL,
        synced_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_title, guid, sink)
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        user_id   INTEGER PRIMARY KEY,
        title     TEXT NOT NULL,
        token     TEXT NOT NULL,
        minted_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.migrate();
  }

  /** Rows written before the column existed are assumed to be seeds. */
  private migrate(): void {
    const cols = this.db.prepare("SELECT name FROM pragma_table_info('synced')").all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "seeded")) {
      this.db.exec("ALTER TABLE synced ADD COLUMN seeded INTEGER NOT NULL DEFAULT 0");
      this.db.exec("UPDATE synced SET seeded = 1");
    }
  }

  getToken(userId: number): string | undefined {
    const row = this.db.prepare("SELECT token FROM tokens WHERE user_id = ?").get(userId) as
      | { token: string }
      | undefined;
    return row?.token;
  }

  saveToken(userId: number, title: string, token: string): void {
    this.db
      .prepare(
        `INSERT INTO tokens (user_id, title, token) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET title = excluded.title, token = excluded.token,
                                            minted_at = datetime('now')`,
      )
      .run(userId, title, token);
  }

  deleteToken(userId: number): void {
    this.db.prepare("DELETE FROM tokens WHERE user_id = ?").run(userId);
  }

  /** True if this sink has ever received (or been seeded with) any item. */
  sinkKnown(sink: string): boolean {
    return this.db.prepare("SELECT 1 FROM synced WHERE sink = ? LIMIT 1").get(sink) !== undefined;
  }

  isSynced(user: string, guid: string, sink: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM synced WHERE user_title = ? AND guid = ? AND sink = ?")
        .get(user, guid, sink) !== undefined
    );
  }

  markSynced(user: string, guid: string, sink: string, title: string, seeded = false): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO synced (user_title, guid, sink, title, seeded) VALUES (?, ?, ?, ?, ?)",
      )
      .run(user, guid, sink, title, seeded ? 1 : 0);
  }

  trackedItemCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(DISTINCT user_title || '|' || guid) c FROM synced")
      .get() as { c: number };
    return row.c;
  }

  requestCountSince(days: number): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) c FROM synced WHERE seeded = 0 AND synced_at > datetime('now', ?)",
      )
      .get(`-${days} days`) as { c: number };
    return row.c;
  }

  recentActivity(limit = 50): {
    user: string;
    title: string;
    sink: string;
    seeded: boolean;
    at: string;
  }[] {
    const rows = this.db
      .prepare(
        "SELECT user_title, title, sink, seeded, synced_at FROM synced ORDER BY synced_at DESC, rowid DESC LIMIT ?",
      )
      .all(limit) as {
      user_title: string;
      title: string;
      sink: string;
      seeded: number;
      synced_at: string;
    }[];
    return rows.map((r) => ({
      user: r.user_title,
      title: r.title,
      sink: r.sink,
      seeded: r.seeded === 1,
      at: r.synced_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
