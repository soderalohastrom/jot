# CLAUDE.md — jot fork (soderalohastrom/jot)

Fork of [badlogic/jot](https://github.com/badlogic/jot). Local notes server with markdown bodies, threaded comments on quoted text, share links, and a back-channel that pipes hot comments to running Claude Code sessions.

## Quick map

```
~/PROJECTS/jot/
├── src/server.ts                  Express app + comment system + webhook dispatcher
├── src/revisions.ts               SQLite-backed body revision history (better-sqlite3 + diff)
├── public/                        Static frontend (app.js, components.js, styles.css)
│                                  Custom features: Zen mode, Save-to popover, files panel, revisions UI
├── cli/jot.mjs                    CLI (Bearer-token auth via ~/.config/jot/settings.json)
├── scripts/
│   ├── jot-to-peers.mjs           ★ Active bridge — webhook → claude-peers
│   ├── webhook-receiver.js        Historical (replaced by bridge above)
│   └── backchannel-poller.js      Historical (replaced by bridge above)
├── ecosystem.config.cjs           PM2 manifest — runs jot + jot-to-peers together
└── data/                          Notes (data/notes/*.json), auth.json, revisions.db, destinations.json
```

## Running locally

```bash
cd ~/PROJECTS/jot
pm2 start ecosystem.config.cjs        # jot on :3210 + bridge on :7891
pm2 logs                              # follow both
pm2 restart jot                       # after source edits to src/server.ts
pm2 restart jot-to-peers              # after edits to scripts/jot-to-peers.mjs
```

Single-instance discipline: if `lsof -nP -iTCP:3210` shows multiple PIDs, hard-reset with `pm2 delete all && pkill -f "src/server.ts" && pm2 start ecosystem.config.cjs`.

## Back-channel architecture (the [?] → CC pipeline)

```
User comments "[?] question" on a jot note
  → jot server fireWebhook (src/server.ts: 4 callsites)
    → POST localhost:7891/webhook
      → jot-to-peers.mjs filters by [?] prefix + loop-guards
        → spawns: bun ~/mcp/claude-peers-mcp/cli.ts send <peerId> <msg>
          → broker delivers channel block to a running CC session
            → that session replies via: node cli/jot.mjs local reply <id> <tid> <mid> "[bot] ..."
              → jot fires webhook for that reply too
                → bridge sees author=mavis OR body startsWith [bot] → skips (loop guard) ✓
```

Trigger convention (from architecture doc — jot `rj3vxfzw`):
- `[?]` prefix → HOT — delivered to peer
- anything else → WARM/COLD — bridge logs skip
- `[bot] ...` prefix on replies → loop guard skip

The bridge fires webhooks for ALL four comment routes:
- `/api/notes/:id/threads` (authenticated thread create)
- `/api/notes/:id/threads/:tid/replies` (authenticated reply)
- `/api/share/:sid/threads` (share-link thread create)
- `/api/share/:sid/threads/:tid/replies` (share-link reply)

If any of these stop firing, check `JOT_WEBHOOK_URL` is set in the jot process env (PM2's ecosystem.config.cjs handles this).

## Peer-ID collision gotcha

claude-peers appears to derive peer IDs from session CWD/repo. **Two CC sessions in the same repo claim the same peer ID** and race for broker delivery (whichever socket responds first wins). Different repos → different IDs → no collision.

For this jot fork, the bridge's `JOT_TO_PEERS_TARGET` defaults to `27f7a3ol` (mise-spring repo). If you're running CC inside the jot repo and want it to receive comments, either:
1. Override at startup: `JOT_TO_PEERS_TARGET=<jot-repo-peer-id> pm2 restart jot-to-peers`
2. Run a single CC session per repo (no race)

## Auth model (CLI vs browser)

- **`data/auth.json`**: `passwordSalt` + `passwordHash` gate browser access; `tokens` (browser session cookies) and `apiKeys` (Bearer tokens for CLI) are separate. gitignored.
- **CLI**: `~/.config/jot/settings.json` holds the Bearer token. Must match an entry in `auth.json:apiKeys`.
- **Browser**: visit `http://localhost:3210/login` → cookie session → access.
- **Recovery**: if password is lost, edit `auth.json` to remove `passwordSalt`/`passwordHash`; next browser visit serves the **setup** page (not login) to set a new one. `tokens` and `apiKeys` preserved.
- **CLI recovery**: if Bearer fails 401, generate a new apiKey via the browser UI OR inject one via the `hashSecret(value, salt)` scrypt scheme used at `src/server.ts:2177`.

## Customizations vs upstream

`upstream` remote = `badlogic/jot`. `origin` = your fork. Major divergences:
- Zen mode toggle (commit `dea1038`)
- Save-to destinations popover (commit `09627a0`) + HTMLpub config in `data/destinations.json`
- Files panel (left sidebar listing all notes)
- Revisions module: SQLite-backed body history with diff viewer (`src/revisions.ts`)
- Back-channel system: webhook dispatcher + bridge + ecosystem (commit `0bcfcfe`)
- AI-triggered refresh endpoint (`/api/admin/reload`, commit `17900a6`)
- `--file` flag on `jot update markdown` for file-native body transport (commit `8564927`)
- `share` CLI command + view/comment share modes (commit `6242f11`)
- Projects (flat folders) — group jots into one-folder-each buckets, addressable from UI, CLI, and API (see below)

## Projects (flat folders)

Each jot carries an optional `project` slug (`NoteMetaFile.project` → `data/notes/<id>.json`). One folder per jot; empty = "Unfiled". Slugs are normalized by `normalizeProject()` in `src/server.ts` (lowercased, spaces→hyphens, `[a-z0-9-_/]` only; `/` is kept legal so a future nested mode is non-breaking, but the UI is flat today).

**The point of it** is pointing an LLM at a whole project. Three surfaces, all owner-auth:

```
# CLI
node cli/jot.mjs local projects                  # folders + jot counts
node cli/jot.mjs local list --project=mise        # filter the list (--project= → unfiled)
node cli/jot.mjs local project read mise           # ★ dump EVERY jot in mise as one markdown stream
node cli/jot.mjs local project read mise --json    # same, JSON with per-note bodies
node cli/jot.mjs local move <id> mise              # file a jot (omit project → unfile)
node cli/jot.mjs local project rename mise mise-spring   # move whole folder (empty → unfiled)

# API
GET  /api/notes?project=mise            # filtered summaries (project= → unfiled)
GET  /api/projects                      # [{ slug, count, updatedAt }], unfiled slug = ""
GET  /api/projects/:slug                # { notes:[{id,title,updatedAt,shareId,markdown}] }
GET  /api/projects/:slug?format=text    # concatenated markdown, paste-ready for CC
POST /api/projects/:slug/rename { to }  # reassign whole folder
PUT  /api/notes/:id { project }         # set a single jot's folder
```

Use `_unfiled` as the `:slug` path segment to address the Unfiled bucket over HTTP (empty path segment isn't routable). The back-channel bridge can pull a whole project via `GET /api/projects/<slug>?format=text` to hand a CC session the full context for "go read all the Mise jots."

**UI:** the files panel groups rows into collapsible folders (Unfiled last; collapse state in `localStorage["jot.folders.collapsed"]`). Drag a row onto a folder header to refile it. Each folder header has `＋` (new jot in folder) and `✎` (rename folder). The editor toolbar shows a project chip next to the title — click it to file the current jot via a datalist of existing folders.

## Common debugging

| Symptom | Check |
|---|---|
| Browser shows login page with no notes | Auth state — `head -3 data/auth.json` to see if password is set; cross-check `~/.config/jot/settings.json` token matches an apiKey |
| `[?]` comment doesn't trigger CC | `pm2 logs jot-to-peers --lines 20` — see if webhook hit the bridge. If not, jot didn't fire (check `JOT_WEBHOOK_URL` env in jot process) |
| Webhook fires but no peer notification | Bridge log shows `sent → <id>` but receiving CC doesn't see it → peer ID mismatch or sibling CC racing for delivery |
| `EADDRINUSE` on port 3210 | Stale jot process. `pkill -f "src/server.ts" && pm2 restart jot` |
| CLI returns 401 | Bearer in settings.json doesn't match any apiKey in auth.json. Inject a new key via the `hashSecret` scrypt scheme or generate one via browser UI |

## Notes for future sessions

- This fork is actively iterating. Always `git pull origin main` before starting work.
- The previous-Scotty practice of 1,479+ lines of uncommitted WIP is real — verify `git status` and commit early.
- `data/` is gitignored (notes, auth, revisions DB, destinations). Backup separately if needed.
- MiniMax was involved in the earlier walkie-based design (scripts/webhook-receiver.js + backchannel-poller.js) but the current direction is CC-only; those scripts can be deleted whenever you want.
- The architecture jot is `rj3vxfzw` — open it in the browser for the original design notes + the threaded discussion that drove the back-channel implementation.

🤙 Ma ka hana ka ʻike — In working, one learns.
