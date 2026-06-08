// Deterministic connection engine for jots — Phase 1 of "live semantic
// connections" (dashboard Queue #4). Derives "related notes" purely from data
// already in each note: explicit links, shared project, title mentions, and
// significant-term overlap. No ML, no external deps.
//
// Computed on-request over the in-memory notes map, so results are always live
// (no index to invalidate). Phase 2 (chunk embeddings) and Phase 3 (LLM
// temporal graph) layer on top of this; both stay optional and provenance-backed.

export type ConnectionEdgeType = "link" | "project" | "mention" | "term";

export type ConnectionEdge = {
  type: ConnectionEdgeType;
  weight: number;
  reason: string;
};

export type Connection = {
  id: string;
  title: string;
  project: string;
  updatedAt: string;
  shareId: string;
  score: number;
  edges: ConnectionEdge[];
};

// Minimal note shape this module needs — keeps it decoupled from the server's
// full NoteRecord (which carries collab state, Maps, etc.).
export type ConnNote = {
  id: string;
  title: string;
  project: string;
  markdown: string;
  updatedAt: string;
  shareId: string;
};

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "has", "had",
  "are", "was", "were", "you", "your", "his", "her", "its", "our", "their",
  "they", "them", "then", "than", "but", "not", "all", "any", "can", "will",
  "would", "could", "should", "into", "out", "about", "over", "under", "more",
  "most", "some", "such", "only", "also", "just", "what", "when", "where",
  "which", "who", "whom", "how", "why", "note", "jot", "notes", "jots",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function significantTerms(note: ConnNote): Set<string> {
  return new Set(tokenize(`${note.title} ${note.markdown}`));
}

// Does `body` explicitly reference `target` by id, shareId, or [[id]] wikilink?
// Substring matching also catches full localhost URLs (…/notes/<id>, …/s/<sid>).
function bodyLinksTo(body: string, target: ConnNote): boolean {
  if (!body) return false;
  if (body.includes(`/notes/${target.id}`)) return true;
  if (body.includes(`[[${target.id}]]`)) return true;
  if (target.shareId && body.includes(`/s/${target.shareId}`)) return true;
  return false;
}

// Title-mention is a softer, wiki-like signal. Require length >= 5 to keep
// generic short titles from matching everywhere.
function mentionsTitle(body: string, title: string): boolean {
  const t = title.trim();
  if (t.length < 5 || /^untitled$/i.test(t)) return false;
  return body.toLowerCase().includes(t.toLowerCase());
}

/**
 * Rank notes related to `targetId` using deterministic edges. A note can connect
 * via several edge types; weights sum (capped at 1) into the final score.
 */
export function computeConnections(
  targetId: string,
  allNotes: Iterable<ConnNote>,
  opts: { limit?: number } = {},
): Connection[] {
  const limit = opts.limit ?? 12;
  const list = Array.from(allNotes);
  const target = list.find((n) => n.id === targetId);
  if (!target) return [];

  // Precompute significant terms per note + document frequency, so the term
  // edge can be IDF-weighted: distinctive shared terms count more than generic
  // vocabulary shared across many notes.
  const termsByNote = new Map<string, Set<string>>();
  const df = new Map<string, number>();
  for (const n of list) {
    const terms = significantTerms(n);
    termsByNote.set(n.id, terms);
    for (const t of terms) df.set(t, (df.get(t) || 0) + 1);
  }
  const docCount = list.length || 1;
  const idf = (t: string) => Math.log(1 + docCount / (df.get(t) || 1));

  const targetTerms = termsByNote.get(target.id) || new Set<string>();
  let targetIdfMass = 0;
  for (const t of targetTerms) targetIdfMass += idf(t);
  const targetBody = target.markdown || "";
  const targetProject = (target.project || "").trim();
  const targetTitle = target.title || "";

  const out: Connection[] = [];

  for (const other of list) {
    if (other.id === targetId) continue;
    const edges: ConnectionEdge[] = [];
    const otherTitle = other.title || "untitled";
    const otherBody = other.markdown || "";

    // link — highest precision, either direction
    if (bodyLinksTo(targetBody, other)) {
      edges.push({ type: "link", weight: 1, reason: `Links to "${otherTitle}"` });
    } else if (bodyLinksTo(otherBody, target)) {
      edges.push({ type: "link", weight: 1, reason: `"${otherTitle}" links here` });
    }

    // project membership
    if (targetProject && (other.project || "").trim() === targetProject) {
      edges.push({ type: "project", weight: 0.6, reason: `Same project: ${targetProject}` });
    }

    // title mention, either direction
    if (mentionsTitle(targetBody, otherTitle)) {
      edges.push({ type: "mention", weight: 0.5, reason: `Mentions "${otherTitle}"` });
    } else if (mentionsTitle(otherBody, targetTitle)) {
      edges.push({ type: "mention", weight: 0.45, reason: `"${otherTitle}" mentions this note` });
    }

    // significant-term overlap (topical), IDF-weighted so distinctive shared
    // terms outweigh generic vocabulary shared across many notes.
    const otherTerms = termsByNote.get(other.id) || new Set<string>();
    const shared: string[] = [];
    let sharedIdf = 0;
    for (const term of targetTerms) {
      if (otherTerms.has(term)) {
        shared.push(term);
        sharedIdf += idf(term);
      }
    }
    if (shared.length >= 2 && targetIdfMass > 0) {
      const weight = Math.min(0.45, (sharedIdf / targetIdfMass) * 0.9);
      if (weight >= 0.05) {
        const sample = shared.sort((a, b) => idf(b) - idf(a)).slice(0, 5);
        edges.push({ type: "term", weight, reason: `Shares terms: ${sample.join(", ")}` });
      }
    }

    if (edges.length === 0) continue;

    out.push({
      id: other.id,
      title: otherTitle,
      project: other.project || "",
      updatedAt: other.updatedAt,
      shareId: other.shareId,
      score: Math.min(1, edges.reduce((sum, e) => sum + e.weight, 0)),
      edges,
    });
  }

  out.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
  return out.slice(0, limit);
}
