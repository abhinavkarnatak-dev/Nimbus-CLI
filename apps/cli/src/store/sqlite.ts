import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  FileChange,
  HistoryItem,
  ModelCall,
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
  // Copies of files Nimbus changed, for undo_changes
  `CREATE TABLE file_changes (
     session_id TEXT NOT NULL,
     turn INTEGER NOT NULL,
     path TEXT NOT NULL,
     display TEXT NOT NULL,
     turn_title TEXT NOT NULL,
     before BLOB,
     after BLOB,
     too_big INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (session_id, turn, path),
     FOREIGN KEY (session_id, turn) REFERENCES turns (session_id, turn) ON DELETE CASCADE
   );`,
  "ALTER TABLE turns ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;",
  // History that replaced earlier turns after compaction
  `CREATE TABLE compactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
     turn INTEGER NOT NULL,
     items TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );`,
];

export interface SavedTurn {
  turn: number;
  status: TurnStatus | "running";
  items: HistoryItem[];
  views: ToolView[];
  // Model calls, for /trace
  calls?: ModelCall[];
  usage: Usage;
  cost: number;
}

export interface SavedSession {
  info: SessionInfo;
  createdAt: number;
  updatedAt: number;
  turns: SavedTurn[];
  fileChanges: FileChange[];
  // Latest compaction: replaces the history before this turn
  compaction: { turn: number; items: HistoryItem[] } | null;
}

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  // Messages sent in this conversation
  turns: number;
}

// What the UI needs to list and reopen sessions
export interface SessionHistory {
  list(cwd: string, limit?: number): SessionSummary[];
  load(sessionId: string): SavedSession | null;
}

export interface SqliteSessionStore extends SessionStore, SessionHistory {
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
    `UPDATE turns SET status = ?, input_tokens = ?, cached_tokens = ?, cache_write_tokens = ?,
       output_tokens = ?, cost = ?, ended_at = ? WHERE session_id = ? AND turn = ?`,
  );
  const touch = db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?");
  const addCompaction = db.prepare(
    "INSERT INTO compactions (session_id, turn, items, created_at) VALUES (?, ?, ?, ?)",
  );
  const upsertChange = db.prepare(
    `INSERT INTO file_changes
       (session_id, turn, path, display, turn_title, before, after, too_big, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_id, turn, path) DO UPDATE SET
       after = excluded.after, too_big = excluded.too_big, updated_at = excluded.updated_at,
       before = CASE WHEN excluded.too_big = 1 THEN NULL ELSE file_changes.before END`,
  );

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
          usage.cacheWriteTokens,
          usage.outputTokens,
          cost,
          now,
          sessionId,
          turn,
        );
        touch.run(now, sessionId);
      });
    },

    saveFileChange(sessionId: string, change: FileChange) {
      upsertChange.run(
        sessionId,
        change.turn,
        change.path,
        change.display,
        change.turnTitle,
        change.before,
        change.after,
        change.tooBig ? 1 : 0,
        Date.now(),
      );
    },

    saveCompaction(sessionId: string, turn: number, items: HistoryItem[]) {
      addCompaction.run(sessionId, turn, JSON.stringify(items), Date.now());
    },

    saveModelCall(sessionId: string, call: ModelCall) {
      addEntry.run(sessionId, call.turn, "call", JSON.stringify(call), Date.now());
    },

    list(cwd: string, limit = 20): SessionSummary[] {
      const rows = db
        .prepare(
          `SELECT s.id, s.title, s.updated_at,
             (SELECT count(*) FROM turns t WHERE t.session_id = s.id) AS turns
           FROM sessions s WHERE s.cwd = ? ORDER BY s.updated_at DESC LIMIT ?`,
        )
        .all(cwd, limit) as Record<string, string | number>[];
      return rows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        updatedAt: Number(row.updated_at),
        turns: Number(row.turns),
      }));
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
      const changes = db
        .prepare("SELECT * FROM file_changes WHERE session_id = ? ORDER BY turn, path")
        .all(sessionId) as Record<string, string | number | Uint8Array | null>[];
      const bytes = (value: unknown) => (value instanceof Uint8Array ? Buffer.from(value) : null);
      const compaction = db
        .prepare(
          "SELECT turn, items FROM compactions WHERE session_id = ? ORDER BY id DESC LIMIT 1",
        )
        .get(sessionId) as { turn: number; items: string } | undefined;
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
            calls: mine
              .filter((e) => e.kind === "call")
              .map((e) => JSON.parse(e.data) as ModelCall),
            usage: {
              inputTokens: Number(t.input_tokens),
              cachedTokens: Number(t.cached_tokens),
              cacheWriteTokens: Number(t.cache_write_tokens),
              outputTokens: Number(t.output_tokens),
            },
            cost: Number(t.cost),
          };
        }),
        fileChanges: changes.map((c) => ({
          turn: Number(c.turn),
          path: String(c.path),
          display: String(c.display),
          turnTitle: String(c.turn_title),
          before: bytes(c.before),
          after: bytes(c.after),
          tooBig: Number(c.too_big) === 1,
        })),
        compaction: compaction
          ? { turn: Number(compaction.turn), items: JSON.parse(compaction.items) as HistoryItem[] }
          : null,
      };
    },

    close() {
      db.close();
    },
  };
}
