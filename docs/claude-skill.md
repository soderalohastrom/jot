<!--
  Reference copy. The canonical SKILL.md is maintained by Roman in the clawd workspace at
  ~/clawd/skills/jot/SKILL.md and is shipped to ~/.npm-global/lib/node_modules/openclaw/skills/jot/
  by the openclaw distribution. This mirror exists so the jot repo documents how Claude / OpenClaw
  agents are expected to drive its CLI. If you change behavior, update the canonical first.
-->

---
name: jot
description: Read, write, edit, and comment on notes in a local Jot server (@mariozechner/jot) via its CLI. Use when the user says "write to jot", "save to jot", "jot this", "comment on jot", "summarize the jot", "rewrite the jot", "list my jots", references a jot note ID (8-char alphanumeric like `o3izadbc`), or pastes a `localhost:3210/s/...` share URL. Jot is a local notes server with markdown bodies and threaded comments on quoted text — treat it as a shared scratchpad between the user and the assistant.
homepage: https://github.com/mariozechner/jot
metadata:
  {
    "openclaw":
      {
        "emoji": "📒",
        "os": ["darwin", "linux"],
        "requires": { "bins": ["jot", "node"] },
        "install":
          [
            {
              "id": "npm",
              "kind": "npm",
              "package": "@mariozechner/jot",
              "global": true,
              "bins": ["jot"],
              "label": "Install jot via npm (global)",
            },
          ],
      },
  }
---

# Jot — collaborative note CLI (v1: narrow scope)

Jot is a local notes server with per-note markdown, threaded comments on quoted text, and share links. The user runs it on `http://localhost:3210` (typically under PM2). The CLI is the only programmatic interface — no MCP, no API wrapper.

**v1 scope is intentionally narrow: trigger phrase → jot verb.** Custom workflows (Save to Project, Save to Wiki, scheduled summaries, multi-note rollups, RAG over the corpus) are v2 — see TODOs at the bottom.

## Setup check (once per session)

Before the first jot call:

1. **Verify the right binary.** `/usr/bin/jot` is BSD `jot` (random number tool) — *not* the notes CLI. Run `jot --help 2>&1 | head -1`. If output starts with `Usage: jot <command>`, you have the right one. If it starts with `usage: jot [-cnr]`, fall back to either `node /Users/soderstrom/2026/April/jot/cli/jot.mjs` (the user's repo) or `$(npm root -g)/@mariozechner/jot/cli/jot.mjs`.
2. **Pick a default instance.** Read `~/.config/jot/settings.json` and use the first entry's `name` (typically `local` or `my-jot`). If `instances` is empty, ask the user for name + base URL + API key — don't guess.
3. Cache the resolved binary + instance name in `~/.cache/openclaw/jot/last.json` (see next section). Reuse across sessions; refresh if the file is missing or the binary stops resolving.

## State file: `~/.cache/openclaw/jot/last.json`

Persistent skill state. Schema:

```json
{
  "binary": "jot",
  "instance": "local",
  "last_note_id": "o3izadbc",
  "last_thread_id": null,
  "last_message_id": null,
  "updated_at": "2026-04-18T12:34:56Z"
}
```

**Update rules:**
- After every successful `read`, `create`, `edit`, `update`, `comment`, or `reply`: rewrite `last_note_id` and `updated_at`. If the operation produced or referenced a thread/message, capture those too.
- "This jot" / "the note" / "that thread" in the next user turn always resolves against this file first.
- Create the directory (`mkdir -p ~/.cache/openclaw/jot`) on first write. Don't error if it doesn't exist — just create it.

The cache exists so the user can say "comment on it" three turns later without re-pasting an ID. Don't over-engineer it; one file, one note ID, optional thread/message.

## Trigger phrase → jot verb

This is the spine of v1. When intent matches a row, run that command and update `last.json`.

| User says | Action |
|---|---|
| "list my jots", "what's in jot", "recent jots" | `jot <inst> list` |
| "search jot for X", "find jot about X" | `jot <inst> search "X"` |
| "read jot \<id>", "show me jot \<id>", "open the jot" | `jot <inst> read <id>` |
| "write this to jot", "save to jot", "jot this" | `jot <inst> create "<title>"` → `jot <inst> update <id> markdown "<body>"` |
| "append to jot", "add to the note" | `read` → `edit` with an end-insert diff (or `update markdown` with appended body) |
| "replace the jot", "rewrite the note with this" | `jot <inst> update <id> markdown "<new body>"` (destructive — confirm if note looks substantial) |
| "change title to X" | `jot <inst> update <id> title "X"` |
| **"summarize the jot"** | `read` → produce summary → **post as a comment on the title line** (non-destructive default). Only write into the body if the user says "into the note", "replace", or "just the summary now". |
| "rewrite / clean up / tighten" | `read` → `edit` with surgical diffs (or `update markdown` for full rewrite). Show proposed changes first if substantial. |
| "comment on jot \<ref>: \<quote> — \<body>" | `jot <inst> comment <id> "<quote>" "<body>"` |
| "reply to that thread" | `jot <inst> reply <id> <tid> <mid> "<body>"` (uses cached `last_thread_id` / `last_message_id`) |
| "resolve / reopen that thread" | `jot <inst> resolve <id> <tid>` / `reopen <id> <tid>` |
| "delete the comment / thread" | `delete-comment <id> <mid>` / `delete-thread <id> <tid>` — confirm first |
| "share jot \<ref>", "get share link" | `read <id>` (share URL is in the header) or `jot <inst> share <id> <none|view|comment|edit>` to set access |
| "delete jot \<ref>" | `jot <inst> delete <id>` — **always confirm** |

## Two locked design decisions (v1)

### 1. Last-touched ID caching (`last.json`)

Why: the user thinks in pronouns ("it", "that", "the jot"). Forcing them to repaste IDs every turn breaks flow. One file, one ID, refreshed on every successful op. If the user explicitly names a different note, that wins and the cache updates.

Resolution order for ambiguous references:
1. Explicit ID (8-char alphanumeric) or share URL in the message
2. Title fuzzy match if the user names a title (run `list` or `search`)
3. `last_note_id` from `last.json`
4. If still ambiguous → ask, don't guess

### 2. Summarize defaults to comment, not edit

Why: rewriting a user's note without asking is destructive. A summary is *commentary* about the note, not a replacement for it — posting as a comment keeps the original intact and preserves the conversation thread. The user can promote a summary into the body explicitly with "replace" or "into the note".

Mirror principle for **rewrite/tighten**: those verbs explicitly invite mutation, so default to `edit` or `update markdown`. Show the diff first only if the note is substantial (~20+ lines).

## Operation gotchas

- **`edit` requires unique substring match.** `oldText` must appear exactly once in the current body. Whitespace, leading hashes, and trailing newlines all count. If it fails, re-`read` and re-quote against the live body.
- **`create` takes title only.** Don't try to pass the body in `create` — follow up with `update <id> markdown`.
- **Three ID spaces.** Note IDs, thread IDs (`tid`), and message IDs (`mid`) are distinct. `read` output prints all three; don't cross them.
- **Server down → restart, don't reinstall.** If commands return `fetch failed`, run `pm2 status`; restart with `pm2 start jot`.
- **Comment authorship.** Comments are attributed to whoever holds the API key (the user). If you want it visibly *from* the assistant, prefix the body with `Claude:` so attribution reads correctly in the UI.

## Quick reference (command shapes)

```
jot <inst> list
jot <inst> search "<query>"
jot <inst> read <id>
jot <inst> create "<title>"
jot <inst> update <id> title "<new title>"
jot <inst> update <id> markdown "<full body>"
jot <inst> edit <id> '[{"oldText":"<exact>","newText":"<new>"}]'
jot <inst> delete <id>
jot <inst> comment <id> "<quote>" "<body>"
jot <inst> reply <id> <tid> <mid> "<body>"
jot <inst> edit-comment <id> <mid> "<new body>"
jot <inst> delete-comment <id> <mid>
jot <inst> resolve <id> <tid>
jot <inst> reopen <id> <tid>
jot <inst> delete-thread <id> <tid>
jot <inst> share <id> <none|view|comment|edit>
```

## v2 TODOs (out of scope for v1)

These are deferred until the v1 trigger map proves out:

- **Save to Project** — when in a git repo, default the title to `<repo>: <topic>` and tag/group notes by repo.
- **Save to Wiki** — pipe a jot into Scotty's craft-wiki (`wiki-raw` skill) on demand.
- **Scheduled summaries** — daily rollup of recent jots into a single digest note.
- **Multi-note rollup / corpus search** — semantic search across all jots, possibly via `qmd` indexing of `data/`.
- **Mode switching** — explicit "I'm working on X, route all jot writes to that note" sticky context, beyond simple last-touched.
- **Inline Claude attribution** — automatic `Claude:` prefix or a separate API key/identity for assistant-authored comments.
- **Bulk operations** — "delete all resolved threads", "archive notes older than N days".
- **Format converters** — export a jot to .md file, import a .md file as a jot.
