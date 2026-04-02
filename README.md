# jot

Minimal self-hosted collaborative markdown editor with inline comment threads. Built for humans and agents.

## Quick Start

```bash
npx @mariozechner/jot serve
```

Open `http://localhost:3210`. Set the owner password on first visit.

## Features

- Collaborative real-time editing (multiple tabs, multiple users)
- Remote cursors with names
- Inline comment threads anchored to text selections
- Threaded replies, resolve/reopen
- Share notes with configurable access (view, comment, edit)
- CLI for humans and agents (owner API keys or share links)
- Agent setup modal with copy-paste instructions
- Dark and light theme
- Mobile support
- Plain `.md` files on disk

## Server

```bash
npx @mariozechner/jot serve                    # port 3210, data in ./data
npx @mariozechner/jot serve --port=8080        # custom port
npx @mariozechner/jot serve --data=/var/jot    # custom data dir
```

## Docker

```bash
cd docker
bash control.sh start
```

## Sharing

Click the share icon in the editor to configure access:

- **Not shared** (default)
- **View only**: read-only preview
- **View & comment**: preview with comment threads
- **Edit & comment**: full collaborative editor

Each note has a stable share URL (`/s/<id>`). Toggle access without changing the link.

## CLI

### Owner mode (API key)

Create an API key from the settings gear on the landing page.

```bash
npx @mariozechner/jot register myserver https://jot.example.com <api-key>
npx @mariozechner/jot myserver list
npx @mariozechner/jot myserver read <note-id>
npx @mariozechner/jot myserver create "My note"
npx @mariozechner/jot myserver edit <note-id> '[{"oldText":"foo","newText":"bar"}]'
npx @mariozechner/jot myserver comment <note-id> "quoted text" "comment body"
npx @mariozechner/jot myserver reply <note-id> <thread-id> <message-id> "reply"
npx @mariozechner/jot myserver resolve <note-id> <thread-id>
npx @mariozechner/jot myserver reopen <note-id> <thread-id>
npx @mariozechner/jot myserver edit-comment <note-id> <message-id> "new body"
npx @mariozechner/jot myserver delete-comment <note-id> <message-id>
npx @mariozechner/jot myserver delete-thread <note-id> <thread-id>
npx @mariozechner/jot myserver update <note-id> title "New title"
npx @mariozechner/jot myserver delete <note-id>
```

### Shared mode (share link)

No API key needed. The share URL is the credential.

```bash
npx @mariozechner/jot register shared https://jot.example.com/s/abc123
npx @mariozechner/jot shared read
npx @mariozechner/jot shared edit '[{"oldText":"foo","newText":"bar"}]'
npx @mariozechner/jot shared comment "quoted text" "comment body" --name="My Agent"
npx @mariozechner/jot shared reply <thread-id> <message-id> "reply" --name="My Agent"
```

### Agent integration

Click the robot icon in the editor or shared view to get copy-paste CLI instructions for your agent. The instructions include the current instance URL, note ID, and full command reference.

## Data

```
data/
  auth.json
  notes/
    <id>.md
    <id>.json
```

Notes are plain markdown files. Metadata, comment threads, and collaborative state live in the sidecar JSON.

## HTTP API

All owner endpoints require `Authorization: Bearer <api-key>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notes` | List notes |
| POST | `/api/notes` | Create note |
| GET | `/api/notes/:id` | Read note |
| PUT | `/api/notes/:id` | Update title, markdown, shareAccess |
| DELETE | `/api/notes/:id` | Delete note |
| POST | `/api/notes/:id/edit` | Apply text edits |
| POST | `/api/notes/:id/threads` | Create comment thread |
| POST | `/api/notes/:id/threads/:tid/replies` | Reply to thread |
| PATCH | `/api/notes/:id/threads/:tid` | Resolve/reopen thread |
| DELETE | `/api/notes/:id/threads/:tid` | Delete thread |
| PATCH | `/api/notes/:id/messages/:mid` | Edit comment |
| DELETE | `/api/notes/:id/messages/:mid` | Delete comment |
| GET | `/api/keys` | List API keys |
| POST | `/api/keys` | Create API key |
| DELETE | `/api/keys/:id` | Delete API key |

Share endpoints (no auth, access controlled by `shareAccess`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/share/:sid` | Read shared note |
| GET | `/api/share/:sid/note` | Read shared note (lightweight) |
| POST | `/api/share/:sid/edit` | Edit (requires edit access) |
| POST | `/api/share/:sid/threads` | Create comment |
| POST | `/api/share/:sid/threads/:tid/replies` | Reply |
| POST | `/api/share/:sid/render` | Render markdown to HTML |

## License

MIT
