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

  isSynced(user: string, guid: string, sink: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM synced WHERE user_title = ? AND guid = ? AND sink = ?")
        .get(user, guid, sink) !== undefined
    );
  }

  markSynced(user: string, guid: string, sink: string, title: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO synced (user_title, guid, sink, title) VALUES (?, ?, ?, ?)",
      )
      .run(user, guid, sink, title);
  }

  close(): void {
    this.db.close();
  }
}
