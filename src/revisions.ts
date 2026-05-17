import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

export type AuthorKind = "owner" | "api-key" | "share-editor";

export interface RevisionRow {
  id: string;
  note_id: string;
  ts: string;
  author_name: string;
  author_kind: AuthorKind;
  title: string;
  body: string;
  body_size: number;
  reason: string | null;
  prev_id: string | null;
}

export interface RevisionMeta {
  id: string;
  note_id: string;
  ts: string;
  author_name: string;
  author_kind: AuthorKind;
  title: string;
  body_size: number;
  reason: string | null;
}

export interface RecordOpts {
  author?: string;
  authorKind?: AuthorKind;
  reason?: string;
}

export interface RecordResult {
  row: RevisionRow;
  created: boolean; // true = new row, false = coalesced update
}

export const REVISION_DEBOUNCE_MS = 90_000;

let db: Database.Database | null = null;
let listStmt: Database.Statement;
let listByAuthorStmt: Database.Statement;
let listSinceStmt: Database.Statement;
let listSinceAuthorStmt: Database.Statement;
let getStmt: Database.Statement;
let allLatestStmt: Database.Statement;
let insertStmt: Database.Statement;
let coalesceUpdateStmt: Database.Statement;
let countForNoteStmt: Database.Statement;

// In-memory authoritative "latest revision per note." Populated at init from
// SQLite (one row per note via window function), maintained on every write.
// This avoids the same-millisecond ts collision that ORDER BY ts DESC can hit
// when ms-precision ISO timestamps tie and lexical id ordering picks wrong.
const latestByNote = new Map<string, RevisionRow>();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  body_size INTEGER NOT NULL,
  reason TEXT,
  prev_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_revisions_note_ts ON revisions(note_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_author_ts ON revisions(author_name, ts DESC);
`;

export function initRevisions(dataDir: string) {
  if (db) {
    return db;
  }
  const file = path.join(dataDir, "revisions.db");
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);

  listStmt = db.prepare(
    `SELECT id, note_id, ts, author_name, author_kind, title, body_size, reason
     FROM revisions WHERE note_id = ?
     ORDER BY ts DESC, id DESC LIMIT ?`,
  );
  listByAuthorStmt = db.prepare(
    `SELECT id, note_id, ts, author_name, author_kind, title, body_size, reason
     FROM revisions WHERE note_id = ? AND author_name = ?
     ORDER BY ts DESC, id DESC LIMIT ?`,
  );
  listSinceStmt = db.prepare(
    `SELECT id, note_id, ts, author_name, author_kind, title, body_size, reason
     FROM revisions WHERE note_id = ? AND ts >= ?
     ORDER BY ts DESC, id DESC LIMIT ?`,
  );
  listSinceAuthorStmt = db.prepare(
    `SELECT id, note_id, ts, author_name, author_kind, title, body_size, reason
     FROM revisions WHERE note_id = ? AND author_name = ? AND ts >= ?
     ORDER BY ts DESC, id DESC LIMIT ?`,
  );
  getStmt = db.prepare(`SELECT * FROM revisions WHERE id = ?`);
  // One row per note: the one with the largest rowid (most recently
  // inserted OR updated, since coalesce uses INSERT OR REPLACE semantics
  // via a fresh INSERT after delete? — no, we just track in memory).
  // Actually we don't need this from SQL once we cache; we use it once at
  // boot to seed the cache.
  allLatestStmt = db.prepare(
    `SELECT r.* FROM revisions r
     INNER JOIN (
       SELECT note_id, MAX(rowid) AS max_rowid
       FROM revisions GROUP BY note_id
     ) m ON r.note_id = m.note_id AND r.rowid = m.max_rowid`,
  );
  insertStmt = db.prepare(
    `INSERT INTO revisions (id, note_id, ts, author_name, author_kind, title, body, body_size, reason, prev_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  coalesceUpdateStmt = db.prepare(
    `UPDATE revisions SET ts = ?, title = ?, body = ?, body_size = ?, reason = ? WHERE id = ?`,
  );
  countForNoteStmt = db.prepare(
    `SELECT COUNT(*) as n FROM revisions WHERE note_id = ?`,
  );

  // Seed the in-memory latest cache from disk
  latestByNote.clear();
  for (const row of allLatestStmt.all() as RevisionRow[]) {
    latestByNote.set(row.note_id, row);
  }

  return db;
}

function ensureDb(): Database.Database {
  if (!db) {
    throw new Error("revisions DB not initialised — call initRevisions() first");
  }
  return db;
}

export function generateRevisionId() {
  return `r-${crypto.randomBytes(8).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10)}`;
}

/**
 * Decide whether to record a revision for a note write.
 *
 * Rules:
 *  - If body and title are byte-identical to the last revision → skip (returns null)
 *  - If last revision is by the same author within REVISION_DEBOUNCE_MS → coalesce
 *    (overwrite that row's body/title/ts; returns { row, created:false })
 *  - Otherwise → insert new row (returns { row, created:true })
 */
export function maybeRecordRevision(
  noteId: string,
  title: string,
  body: string,
  opts: RecordOpts = {},
): RecordResult | null {
  ensureDb();
  const author = opts.author || "Owner";
  const authorKind: AuthorKind = opts.authorKind || "owner";
  const reason = opts.reason || null;
  const now = new Date();
  const ts = now.toISOString();
  const bodySize = Buffer.byteLength(body, "utf8");

  const last = latestByNote.get(noteId);

  if (last && last.body === body && last.title === title) {
    return null;
  }

  if (last && last.author_name === author) {
    const lastMs = Date.parse(last.ts);
    if (!Number.isNaN(lastMs) && now.getTime() - lastMs < REVISION_DEBOUNCE_MS) {
      coalesceUpdateStmt.run(ts, title, body, bodySize, reason, last.id);
      const updated: RevisionRow = { ...last, ts, title, body, body_size: bodySize, reason };
      latestByNote.set(noteId, updated);
      return { row: updated, created: false };
    }
  }

  const id = generateRevisionId();
  const prev_id = last ? last.id : null;
  insertStmt.run(
    id,
    noteId,
    ts,
    author,
    authorKind,
    title,
    body,
    bodySize,
    reason,
    prev_id,
  );
  const row: RevisionRow = {
    id,
    note_id: noteId,
    ts,
    author_name: author,
    author_kind: authorKind,
    title,
    body,
    body_size: bodySize,
    reason,
    prev_id,
  };
  latestByNote.set(noteId, row);
  return { row, created: true };
}

/**
 * Insert a v0 import revision for an existing note that has no history yet.
 * Skips silently if the note already has any revisions.
 */
export function importInitialRevision(
  noteId: string,
  title: string,
  body: string,
  ts: string,
  author = "Owner",
): RevisionRow | null {
  ensureDb();
  const count = (countForNoteStmt.get(noteId) as { n: number }).n;
  if (count > 0) return null;

  const id = generateRevisionId();
  const bodySize = Buffer.byteLength(body, "utf8");
  insertStmt.run(
    id,
    noteId,
    ts,
    author,
    "owner" satisfies AuthorKind,
    title,
    body,
    bodySize,
    "import",
    null,
  );
  const row: RevisionRow = {
    id,
    note_id: noteId,
    ts,
    author_name: author,
    author_kind: "owner",
    title,
    body,
    body_size: bodySize,
    reason: "import",
    prev_id: null,
  };
  latestByNote.set(noteId, row);
  return row;
}

export function listRevisions(
  noteId: string,
  filters: { author?: string; since?: string; limit?: number } = {},
): RevisionMeta[] {
  ensureDb();
  const limit = Math.min(Math.max(filters.limit || 200, 1), 1000);
  if (filters.author && filters.since) {
    return listSinceAuthorStmt.all(noteId, filters.author, filters.since, limit) as RevisionMeta[];
  }
  if (filters.author) {
    return listByAuthorStmt.all(noteId, filters.author, limit) as RevisionMeta[];
  }
  if (filters.since) {
    return listSinceStmt.all(noteId, filters.since, limit) as RevisionMeta[];
  }
  return listStmt.all(noteId, limit) as RevisionMeta[];
}

export function getRevision(revId: string): RevisionRow | null {
  ensureDb();
  const row = getStmt.get(revId) as RevisionRow | undefined;
  return row || null;
}

export function countRevisionsForNote(noteId: string): number {
  ensureDb();
  return (countForNoteStmt.get(noteId) as { n: number }).n;
}

export function closeRevisions() {
  if (db) {
    db.close();
    db = null;
  }
  latestByNote.clear();
}
