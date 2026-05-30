# Jot folder creation & organization — design

**Date:** 2026-05-29
**Status:** Approved (browser-only persistence, vanish-on-empty)
**Scope:** Frontend only — `public/app.js` (`setupFilesPanel` module + panel template), `public/styles.css`, and `public/components.js` (added `folder` + `folderPlus` SVG icons — the ICONS set had no folder glyph, so an `icon="folder"` button would have rendered empty). No server/CLI/API changes.

## Problem

A "folder" in jot has no independent existence — it is purely emergent from notes
sharing a `project` tag (`app.js` groups `notesCache` by `n.project`). So:

- The files panel only renders folders that already contain notes. With every note
  Unfiled, the only header shown is "Unfiled".
- Drag-drop only targets existing folder headers (`[data-drop-slug]`), so with no
  folders there is nothing to drag onto.
- The `＋` "new note in folder" button lives on a folder header that does not exist yet.
- The only real folder-creation path is the easily-missed project chip by the title.

The panel is a read-only mirror with no create affordances. That is the gap.

## Decision

"Empty folders you drag into" — Finder-like. Empty folders are first-class in the UI
but persisted **browser-only** (localStorage), mirroring the existing collapse-state
pattern. The moment a note is filed into one it becomes a real (note-backed) folder,
visible everywhere (CLI/API/LLM). **Vanish-on-empty:** dragging the last note out of a
folder makes it disappear (back to emergent-from-notes); empty placeholders are removed
with an explicit `✕`.

### Why browser-only (agent-parity gate)

An empty folder has no content for an agent to read. Nothing with content ever becomes
browser-only — as soon as a note lands in a folder it is a normal `note.project`, fully
reachable by `/api/projects/:slug`, the CLI, and "read whole project". A server-side
registry (`projects.json` + endpoints) is more surface area + drift risk for a feature
whose only payload is "a name with nothing in it yet" — YAGNI. See memory
`feedback-agent-parity`.

## Components (all inside `setupFilesPanel` IIFE)

1. **`jot.folders.empty` localStorage set** + `loadEmptyFolders()`/`saveEmptyFolders()`,
   exactly paralleling `jot.folders.collapsed`.
2. **`normalizeProjectSlug(value)`** — client mirror of server `normalizeProject`
   (`server.ts:119`) so a browser-made slug collapses identically to a filed one.
3. **`＋ New folder` button** in the files-panel header (existing `folder` icon).
   Click → `window.prompt` → normalize → add to empty set → ensure expanded → re-render.
4. **`renderFolder` empty mode** — when `rows.length === 0`: an `empty` marker instead of
   a count, a dashed `drag notes here…` hint as the body (itself a `data-drop-slug`
   target), and a `✕` remove action. The existing `＋` (new note in folder) is retained.
5. **`renderList` merge + prune** — group notes by project; drop any empty-set slug that
   now has notes (saving the pruned set); merge remaining empty slugs in (skipped while
   searching); empty-state check becomes `groups.size === 0`.
6. **Click handler `remove` branch** — forget the name from the empty set, re-render.
7. **Drag-drop** — unchanged machinery. Empty folder headers/hints are valid drop targets
   via `data-drop-slug`. Vanish-on-empty is automatic (a folder with zero notes is not in
   `groups`, so it is not rendered).

## Data flow

```
New folder  → prompt → normalizeProjectSlug → emptyFolders.add → saveEmptyFolders → renderList (merges it in)
Drag into   → moveNote(PUT project) → fetchList → renderList → prune (now real) 
Drag out last note → moveNote → fetchList → renderList → source folder absent from groups → vanishes
Remove ✕    → emptyFolders.delete → saveEmptyFolders → renderList
```

## Edge cases

- **Name collides with a real folder:** harmless — added to empty set, then immediately
  pruned by `renderList` because `groups` already has it; renders as the real folder.
- **Search active:** empty placeholders are not merged (nothing to match); pruning still
  runs and is always safe (a slug in `groups` truly has a matching note).
- **`＋` new-note-in-folder on an empty placeholder:** creates a note filed there; the
  cross-note `note-created` event → `fetchList` → prune → it is now a real folder.
- **No notes + one empty folder:** `groups.size > 0` (the merged empty slug) → renders the
  placeholder rather than "No notes yet.".

## Out of scope

Server-side empty folders, nested folders (slug `/` stays legal but flat), multi-select
drag, folder reordering.
