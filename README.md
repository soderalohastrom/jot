# jot

Minimal self-hosted markdown editor with inline comment threads.

- Single owner, password set on first startup
- Per-device auth tokens
- Plain `.md` files on disk
- Split editor/preview
- Syntax highlighting in preview
- Share notes via public URL
- Inline comment threads anchored to text selections
- Threaded replies, resolve/reopen
- Anonymous commenters with cookie-based identity
- Dark and light theme
- Mobile support

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3210`. Set the owner password on first visit.

## Production

```bash
npm run build
node dist/server.js                          # port 3210, data in ./data
node dist/server.js --port=8080              # custom port
node dist/server.js --data=/var/lib/jot       # custom data directory
```

## Docker

```bash
docker compose up --build
```

## API

Create an API key from the landing page. Use it with the CLI or any HTTP client.

### CLI

```bash
npm install -g .                             # or just use node cli/jot.mjs
jot register myserver https://jot.example.com <api-key>
jot myserver list
jot myserver search "query"
jot myserver read <id>
jot myserver create "My note"
jot myserver edit <id> '[{"oldText":"foo","newText":"bar"}]'
jot myserver update <id> title "New title"
jot myserver delete <id>
```

### HTTP

```bash
curl -H "Authorization: Bearer <api-key>" https://jot.example.com/api/notes
```

## Data

```
data/
  auth.json
  notes/
    <id>.md
    <id>.json
```

Notes are plain markdown files. Metadata and comment threads live in the sidecar JSON.

## No support

This is a personal tool. No issues, no PRs, no support. Fork it if you want.

## License

MIT
