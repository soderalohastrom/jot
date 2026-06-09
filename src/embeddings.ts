// Local semantic embeddings for jots — Phase 2 of "live semantic connections"
// (dashboard Queue #4). Embeds each note with a local Ollama model, caches the
// vectors in SQLite (content-hash incremental, never re-embeds unchanged notes),
// and returns cosine nearest-neighbours. No external service, no cloud — Ollama
// runs locally. Feeds the connections engine as a "semantic" edge type.
//
// Mirrors revisions.ts: module-singleton Database, init(dataDir) at startup,
// `embeddings.db` next to `revisions.db` (both gitignored, derived state).

import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.JOT_EMBED_MODEL || "nomic-embed-text";
// Cap body length fed to the embedder — keeps it fast and within model context.
const MAX_CHARS = 2000;

export type EmbedNote = { id: string; title: string; markdown: string };
export type SemanticNeighbor = { id: string; score: number };

let db: Database.Database | null = null;
let upsertStmt: Database.Statement;
let getStmt: Database.Statement;
let allStmt: Database.Statement;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS embeddings (
  note_id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  hash TEXT NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function initEmbeddings(dataDir: string) {
  if (db) return;
  db = new Database(path.join(dataDir, "embeddings.db"));
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  upsertStmt = db.prepare(
    `INSERT INTO embeddings (note_id, model, dim, hash, vector, updated_at)
     VALUES (@note_id, @model, @dim, @hash, @vector, @updated_at)
     ON CONFLICT(note_id) DO UPDATE SET
       model=@model, dim=@dim, hash=@hash, vector=@vector, updated_at=@updated_at`,
  );
  getStmt = db.prepare(`SELECT note_id, model, hash, vector FROM embeddings WHERE note_id = ?`);
  allStmt = db.prepare(`SELECT note_id, vector FROM embeddings WHERE model = ?`);
}

export function embeddingsReady(): boolean {
  return db !== null;
}

function contentHash(title: string, markdown: string): string {
  return crypto.createHash("sha256").update(`${title}\n${markdown}`).digest("hex");
}

function embedInput(note: EmbedNote): string {
  // nomic-embed-text expects a task prefix; truncate body to keep it fast.
  const body = (note.markdown || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  return `search_document: ${note.title || "untitled"}\n${body}`;
}

async function callOllama(input: string): Promise<Float32Array> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: input }),
  });
  if (!res.ok) throw new Error(`Ollama embeddings ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { embedding?: number[] };
  if (!json.embedding || !json.embedding.length) throw new Error("Ollama returned no embedding");
  return Float32Array.from(json.embedding);
}

function vecToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

// readFloatLE avoids any ArrayBuffer-pool / alignment surprises from better-sqlite3.
function blobToVec(buf: Buffer): Float32Array {
  const out = new Float32Array(buf.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Embed any notes whose content changed or are missing. Incremental: unchanged
 * notes (same content hash + model) are skipped. A single note's Ollama failure
 * is swallowed (counted) so one bad note never sinks a whole connections request.
 */
export async function ensureEmbeddings(notes: EmbedNote[]): Promise<{ embedded: number; failed: number; skipped: number }> {
  if (!db) throw new Error("initEmbeddings() not called");
  let embedded = 0, failed = 0, skipped = 0;
  for (const note of notes) {
    const hash = contentHash(note.title || "", note.markdown || "");
    const row = getStmt.get(note.id) as { hash: string; model: string } | undefined;
    if (row && row.hash === hash && row.model === EMBED_MODEL) {
      skipped++;
      continue;
    }
    try {
      const vec = await callOllama(embedInput(note));
      upsertStmt.run({
        note_id: note.id,
        model: EMBED_MODEL,
        dim: vec.length,
        hash,
        vector: vecToBlob(vec),
        updated_at: new Date().toISOString(),
      });
      embedded++;
    } catch {
      failed++;
    }
  }
  return { embedded, failed, skipped };
}

/**
 * Cosine nearest-neighbours of `targetId` across the given notes. Ensures every
 * note is embedded first (incremental), then brute-force cosine — fine for a
 * personal corpus (hundreds–low thousands). Returns ranked, above `minScore`.
 */
export async function semanticNeighbors(
  targetId: string,
  notes: EmbedNote[],
  opts: { limit?: number; minScore?: number; center?: boolean } = {},
): Promise<SemanticNeighbor[]> {
  if (!db) throw new Error("initEmbeddings() not called");
  const limit = opts.limit ?? 12;
  // Mean-centering removes the common component that makes raw nomic cosines
  // bunch near ~0.75; centered scores spread out and discriminate far better.
  const center = opts.center !== false;
  const minScore = opts.minScore ?? (center ? 0.15 : 0.6);
  await ensureEmbeddings(notes);

  const rows = allStmt.all(EMBED_MODEL) as { note_id: string; vector: Buffer }[];
  const vecs = rows.map((r) => ({ id: r.note_id, v: blobToVec(r.vector) }));
  const targetEntry = vecs.find((x) => x.id === targetId);
  if (!targetEntry) return [];

  let centroid: Float32Array | null = null;
  if (center && vecs.length > 1) {
    const dim = targetEntry.v.length;
    centroid = new Float32Array(dim);
    for (const { v } of vecs) for (let i = 0; i < dim; i++) centroid[i] += v[i];
    for (let i = 0; i < dim; i++) centroid[i] /= vecs.length;
  }
  const adjust = (v: Float32Array): Float32Array => {
    if (!centroid) return v;
    const o = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) o[i] = v[i] - centroid[i];
    return o;
  };

  const tv = adjust(targetEntry.v);
  const out: SemanticNeighbor[] = [];
  for (const { id, v } of vecs) {
    if (id === targetId) continue;
    const score = cosine(tv, adjust(v));
    if (score >= minScore) out.push({ id, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
