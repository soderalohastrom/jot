# Projects (flat folders) — feature handoff

A way to group jots into folders, organize them from the web UI, and — the real
point — **point an LLM at a whole project**: "go read all the jots in the Mise
folder." Built on the `soderalohastrom/jot` fork.

Branch: `feat/projects-folders`
Files touched: `src/server.ts`, `cli/jot.mjs`, `public/app.js`, `public/styles.css`, `CLAUDE.md`

---

## The mental model

- Every jot carries an optional **`project`** slug. One folder per jot (not tags).
- Empty/absent `project` = **Unfiled** (the root bucket).
- Folders are **derived**, not stored separately: a folder exists exactly as long
  as ≥1 jot points at it. Rename = reassign every jot in it. Empty it out and it's gone.
- Slugs are **flat today** but `/` is a legal character, so turning on nested
  folders later is a non-breaking change to the data.

Slugs are normalized by `normalizeProject()` in `src/server.ts`: lowercased,
spaces→hyphens, only `[a-z0-9-_/]`, collapsed dashes, trimmed, max 60 chars.
So `"Mise Spring!"` → `mise-spring`.

---

## How to use it

### In the browser
- **Files panel** now groups jots into collapsible folders (Unfiled always last).
  Collapse state is remembered per-folder in `localStorage["jot.folders.collapsed"]`.
- **Drag a jot row onto a folder header** to refile it.
- Each folder header reveals two actions on hover:
  - **＋** — create a new jot already filed in that folder
  - **✎** — rename the folder (reassigns every jot in it; rename to empty → Unfiled)
- The **project chip** next to the title in the editor toolbar shows the current
  jot's folder. Click it, type or pick from existing folders (datalist), press
  Enter to file. Esc or click-away cancels.

### From the CLI
```bash
node cli/jot.mjs local projects                    # list folders with jot counts
node cli/jot.mjs local list                        # now shows: id  [project]  title  updated
node cli/jot.mjs local list --project=mise         # only jots in mise (--project= alone → unfiled)

node cli/jot.mjs local move <id> mise              # file a jot (omit project → unfile)
node cli/jot.mjs local project rename mise mise-spring   # rename whole folder (empty newSlug → unfiled)

# ★ The point of the whole feature:
node cli/jot.mjs local project read mise           # dump EVERY jot in mise as one markdown stream
node cli/jot.mjs local project read mise --json    # same, structured JSON with per-note bodies
node cli/jot.mjs local project list mise           # id / title / updated rows for the folder
```

`project read` is paste-ready: each jot is fenced with a header and its id, so you
can pipe the whole folder into a Claude Code session as context.

### Over the API (all owner-auth)
```
GET  /api/notes?project=mise            # filtered summaries (project= → unfiled bucket)
GET  /api/projects                      # [{ slug, count, updatedAt }]  (unfiled slug = "")
GET  /api/projects/:slug                # { ok, project, count, notes:[{id,title,updatedAt,shareId,markdown}] }
GET  /api/projects/:slug?format=text    # concatenated markdown, paste-ready
POST /api/projects/:slug/rename { to }  # reassign whole folder
PUT  /api/notes/:id { project }         # set a single jot's folder
POST /api/notes { project }             # create a jot directly inside a folder
```

**Addressing the Unfiled bucket over HTTP:** an empty path segment isn't routable,
so use the literal `_unfiled` — e.g. `GET /api/projects/_unfiled?format=text`. The
CLI does this for you.

---

## Wiring the back-channel to a project

The bridge (`scripts/jot-to-peers.mjs`) can hand a CC session the full context for
a project by pulling the text dump:

```
GET http://localhost:3210/api/projects/mise?format=text
```

That's the natural hook for a `[?] go read all the Mise jots` style trigger — fetch
the folder, deliver it to the peer as one block.

---

## What changed, file by file

**`src/server.ts`**
- `project` added to `NoteMetaFile`, `NoteRecord`, `NoteSummary`, `PersistOpts`,
  and the client serialization.
- `normalizeProject()` helper (the slug rules above).
- Wired through `loadNotesIntoMemory`, `persistNote`, `createNote`, `summarizeNote`,
  `serializeNoteForClient`.
- `/api/notes` gained a `?project=` filter; `POST /api/notes` accepts `project`;
  `PUT /api/notes/:id` accepts `project` (broadcasts `note-meta-updated`, revision
  reason `move-project`).
- New routes: `GET /api/projects`, `GET /api/projects/:slug` (+ `?format=text`),
  `POST /api/projects/:slug/rename`.

**`cli/jot.mjs`**
- `request()` gained a `{ raw: true }` option for the text stream.
- `list` shows the project column + `--project=` filter.
- New commands: `projects`, `project read|list|rename`, `move`.
- Usage text updated.

**`public/app.js`**
- Files panel rewritten to group rows into collapsible folders with per-folder
  collapse persistence, drag-and-drop refiling, and `＋`/`✎` folder actions.
- New toolbar **project chip** + inline picker (`setupProjectChip`), refreshed from
  `applyNotePayload`.

**`public/styles.css`**
- Styles for `.files-folder`, `.folder-header` (+ drop-over state), `.folder-actions`,
  the project chip, and the picker popover. Uses the existing CSS variables so it
  inherits your theme.

**`CLAUDE.md`** — a "Projects (flat folders)" section documenting all of the above.

---

## Backward compatibility & verification

- Existing notes have no `project` field → they load as **Unfiled**. Nothing to migrate.
- `tsc --noEmit` is clean; `node --check` passes on `cli/jot.mjs` and `public/app.js`;
  `normalizeProject()` passes a small unit-test sweep.
- No live process was restarted during the build. To pick up the server changes:
  `pm2 restart jot`. CLI/frontend changes apply on next invocation / browser reload.

---

## Ideas for next iterations

- **Nested folders** — the data already tolerates `/`; the UI just needs to split
  on it and indent.
- **Per-folder share** — a read-only share link that renders a whole project.
- **Bridge trigger** — `[?] read project <slug>` convention that auto-pulls the
  `format=text` dump into the peer.
- **Bulk move** — multi-select rows in the files panel, drag the set into a folder.

🤙 Ma ka hana ka ʻike — In working, one learns.
