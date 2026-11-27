import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  HistoryItem,
  SessionInfo,
  SessionStore,
  ToolView,
  TurnStatus,
  Usage,
} from "@nimbus/harness";

// Each entry upgrades the schema by one version
const MIGRATIONS = [
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     cwd TEXT NOT NULL,
     model TEXT NOT NULL,
     title TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_by_folder ON sessions (cwd, updated_at DESC);
   CREATE TABLE turns (
     session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
     turn INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'running',
     input_tokens INTEGER NOT NULL DEFAULT 0,
     cached_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     cost REAL NOT NULL DEFAULT 0,
     started_at INTEGER NOT NULL,
     ended_at INTEGER,
     PRIMARY KEY (session_id, turn)
   );
   CREATE TABLE entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT NOT NULL,
     turn INTEGER NOT NULL,
     kind TEXT NOT NULL,
     data TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     FOREIGN KEY (session_id, turn) REFERENCES turns (session_id, turn) ON DELETE CASCADE
   );
   CREATE INDEX entries_by_turn ON entries (session_id, turn, id);`,
];

export interface SavedTurn {
  turn: number;
  status: TurnStatus | "running";
  items: HistoryItem[];
  views: ToolView[];
  usage: Usage;
  cost: number;
}

export interface SavedSession {
  info: SessionInfo;
  createdAt: number;
  updatedAt: number;
  turns: SavedTurn[];
}

export interface SqliteSessionStore extends SessionStore {
  load(sessionId: string): SavedSession | null;
  close(): void;
}

function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let next = version; next < MIGRATIONS.length; next++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[next]!);
      db.exec(`PRAGMA user_version = ${next + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

// Sessions in one SQLite file, written after every step
export function openSessionStore(path: string): SqliteSessionStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 3000");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);

  const upsertSession = db.prepare(
    `INSERT INTO sessions (id, cwd, model, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET model = excluded.model, updated_at = excluded.updated_at`,
  );
  const startTurn = db.prepare(
    "INSERT OR IGNORE INTO turns (session_id, turn, started_at) VALUES (?, ?, ?)",
  );
  const addEntry = db.prepare(
    "INSERT INTO entries (session_id, turn, kind, data, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const finishTurn = db.prepare(
    `UPDATE turns SET status = ?, input_tokens = ?, cached_tokens = ?, output_tokens = ?,
       cost = ?, ended_at = ? WHERE session_id = ? AND turn = ?`,
  );
  const touch = db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?");

  const inTransaction = (work: () => void) => {
    db.exec("BEGIN");
    try {
      work();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  return {
    saveItems(session: SessionInfo, turn: number, items: HistoryItem[]) {
      const now = Date.now();
      inTransaction(() => {
        upsertSession.run(session.id, session.cwd, session.model, session.title, now, now);
        startTurn.run(session.id, turn, now);
        for (const item of items) addEntry.run(session.id, turn, "item", JSON.stringify(item), now);
      });
    },

    saveToolView(sessionId: string, turn: number, view: ToolView) {
      addEntry.run(sessionId, turn, "view", JSON.stringify(view), Date.now());
    },

    endTurn(sessionId: string, turn: number, status: TurnStatus, usage: Usage, cost: number) {
      const now = Date.now();
      inTransaction(() => {
        finishTurn.run(
          status,
          usage.inputTokens,
          usage.cachedTokens,
          usage.outputTokens,
          cost,
          now,
          sessionId,
          turn,
        );
        touch.run(now, sessionId);
      });
    },

    load(sessionId: string): SavedSession | null {
      const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
        Record<string, string | number> | undefined;
      if (!row) return null;
      const turns = db
        .prepare("SELECT * FROM turns WHERE session_id = ? ORDER BY turn")
        .all(sessionId) as Record<string, string | number>[];
      const entries = db
        .prepare("SELECT turn, kind, data FROM entries WHERE session_id = ? ORDER BY id")
        .all(sessionId) as { turn: number; kind: string; data: string }[];
      return {
        info: {
          id: String(row.id),
          cwd: String(row.cwd),
          model: String(row.model),
          title: String(row.title),
        },
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        turns: turns.map((t) => {
          const mine = entries.filter((entry) => entry.turn === Number(t.turn));
          return {
            turn: Number(t.turn),
            status: String(t.status) as SavedTurn["status"],
            items: mine
              .filter((e) => e.kind === "item")
              .map((e) => JSON.parse(e.data) as HistoryItem),
            views: mine.filter((e) => e.kind === "view").map((e) => JSON.parse(e.data) as ToolView),
            usage: {
              inputTokens: Number(t.input_tokens),
              cachedTokens: Number(t.cached_tokens),
              outputTokens: Number(t.output_tokens),
            },
            cost: Number(t.cost),
          };
        }),
      };
    },

    close() {
      db.close();
    },
  };
}
