# Jot — Roadmap & Vision

Three surfaces for one notes engine. The **Express server is the product**; everything
else (CLI, agents, desktop shell, public host) speaks to its HTTP API. Agent-parity is
the through-line: anything a human can do, an agent can do via the CLI/API.

> Companion docs: feature audit (jot note `lddzri1p`), pack dashboard (`tv3xzni6`),
> fork notes in `CLAUDE.md`, execution plan in `~/.claude/plans/quiet-purring-llama.md`.

## Surface 1 — Local workspace (today) ✅

`localhost:3210` under PM2. Private, full-feature, agent-driven.

- **Retrieval stack:** fuzzy search · deterministic connections (link / project / mention / term edges) · semantic embeddings (local Ollama `nomic-embed-text`, mean-centered cosine). Surfaces: `GET /api/notes/:id/connections`, `jot connections <id>`, the note-view "Related" strip, and `project read <slug>` (whole-folder markdown dump for an LLM).
- **Sharing:** access ladder (none / view / comment / edit), stable `/s/<shareId>` URL, inline owner share control.
- **UI:** Zen mode, card-grid Home, Related strip, files panel, search-mode toggle, root bucket.
- **History:** SQLite revisions + diff, save-to destinations, `--file` transport, refresh/nudge.
- **Agent infra:** webhook dispatcher + `jot-to-peers` back-channel (`[?]`→Claude Code, currently dormant), the herdr pack comms loop.

## Surface 2 — Public VPS sharing (next) 🚧

Make `/s/` links resolve for anyone, on the Hostinger VPS. **Model: selective publish** —
localhost stays the private workspace; push chosen notes to a *separate* public instance
(its own `data/` and owner auth). Not a mirror.

- **No code change for public URLs** — share links are origin-relative (`public/app.js`), and the server builds them from the request host with `trust proxy` on (`src/server.ts`). Behind a proxy they become `https://DOMAIN/s/<id>` automatically.
- **Deploy:** Node 22 + PM2 + Caddy (auto-HTTPS + WebSocket) on Ubuntu. Prod runs the compiled build (`node dist/server.js`) — no tsx. (The repo also ships a Docker + Caddy path as an alternative.)
- **Publish workflow:** `jot register vps https://DOMAIN <key>`, then `jot <src> publish <id> --to=vps [--access=view]` (new CLI verb) → prints the public `https://DOMAIN/s/<id>`.
- **Security:** claim the owner setup page *before* exposing publicly; firewall port 3210 (Caddy-only); do not run `jot-to-peers` on the VPS; Ollama optional (semantic edges degrade gracefully without it).

## Surface 3 — Tauri 2 desktop (future) 🔭

A native shell, **not a rewrite**. The Express server stays the product.

- **`desktop/`** directory in this monorepo: a Tauri 2 app with a native webview pointed at `http://localhost:3210` — zero frontend rewrite, so Zen mode / card grid / Related strip all come free.
- **Lifecycle:** spawn-or-adopt — on launch, health-check `:3210`; adopt a running PM2 instance or spawn its own; never kill a server it didn't start.
- **Native sugar:** tray / menu-bar presence, global hotkey → quick-capture jot, native notifications fed by the existing webhook, launch-at-login.
- **Distribution:** compile the server to a sidecar binary; signed `.dmg` (logo assets already sit in the repo root).
- **Fork trigger:** when upstream (`badlogic/jot`) merges stop paying off, or the first signed build ships to someone else. Until then, stay in this monorepo as `desktop/` — purely additive, zero risk to the server/CLI/agent workflows.

## The workflow

**Work local → publish to VPS to share → (future) run as a desktop app.** One engine, three doors.

## Open decisions

- **Folders / projects** — possibly dangling now that search is fuzzy + graph + semantic. Keep `project read` (unique value: deterministic "everything in X" dump). Lean: evolve manual foldering into a *visual Home-in-groups* layout rather than deprecate. Spec later.
- **Comment hook** — revive as comments-as-commands (backed by the retrieval stack), or retire the scripts.
- **Phase 3 retrieval** — LLM temporal entity graph. Parked.
- **Embeddings** — chunking, startup pre-warm, model swap (`embeddinggemma` / `qwen3-embedding`). As needed.
