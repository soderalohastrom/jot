#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const configDir = path.join(os.homedir(), ".config", "jot");
const configPath = path.join(configDir, "settings.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return { instances: [] };
  }
}

function saveConfig(config) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function getInstance(name) {
  const config = loadConfig();
  const instance = config.instances.find((i) => i.name === name);
  if (!instance) {
    console.error(`Unknown instance: ${name}`);
    console.error(`Run: jot register <name> <baseUrl> <token>`);
    process.exit(1);
  }
  return instance;
}

async function request(instance, method, endpoint, body) {
  const url = `${instance.baseUrl.replace(/\/$/, "")}${endpoint}`;
  const options = {
    method,
    headers: {},
  };

  if (instance.token) {
    options.headers.Authorization = `Bearer ${instance.token}`;
  }

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok) {
    console.error(`Error ${response.status}: ${payload.error || payload.errors?.join(", ") || "Request failed"}`);
    process.exit(1);
  }

  return payload;
}

function isShareInstance(instance) {
  return Boolean(instance.shareId && !instance.token);
}

function computeLineDiff(oldText, newText) {
  // Simple LCS line diff. For typical markdown notes (a few hundred lines)
  // this is fine; if perf ever matters we'd swap to Myers via the diff lib.
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const segs = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { segs.push({ kind: "ctx", line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { segs.push({ kind: "del", line: a[i] }); i++; }
    else { segs.push({ kind: "add", line: b[j] }); j++; }
  }
  while (i < m) { segs.push({ kind: "del", line: a[i++] }); }
  while (j < n) { segs.push({ kind: "add", line: b[j++] }); }
  return segs;
}

function printUnifiedDiff(revision, currentMarkdown) {
  const segs = computeLineDiff(revision.body, currentMarkdown);
  const useColor = process.stdout.isTTY;
  const RED = useColor ? "\x1b[31m" : "";
  const GREEN = useColor ? "\x1b[32m" : "";
  const DIM = useColor ? "\x1b[2m" : "";
  const RESET = useColor ? "\x1b[0m" : "";
  console.log(`--- ${revision.id} (${revision.author_name} @ ${revision.ts})`);
  console.log(`+++ current`);
  for (const s of segs) {
    if (s.kind === "del") console.log(`${RED}-${s.line}${RESET}`);
    else if (s.kind === "add") console.log(`${GREEN}+${s.line}${RESET}`);
    else console.log(`${DIM} ${s.line}${RESET}`);
  }
}

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  printUsage();
  process.exit(0);
}

if (command === "serve") {
  const portArg = args.find((a) => a.startsWith("--port="));
  const dataArg = args.find((a) => a.startsWith("--data="));
  const cliDir = path.dirname(new URL(import.meta.url).pathname);
  const serverPath = path.join(cliDir, "..", "dist", "server.js");
  if (!fs.existsSync(serverPath)) {
    console.error(`Server not found at ${serverPath}. Run 'npm run build' first.`);
    process.exit(1);
  }
  const serverArgs = [serverPath];
  if (portArg) serverArgs.push(portArg);
  if (dataArg) serverArgs.push(dataArg);
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync(process.execPath, serverArgs, { stdio: "inherit" });
  } catch (e) {
    process.exit(e.status || 1);
  }
  process.exit(0);
}

if (command === "register") {
  const [, name, urlOrBase, token] = args;
  if (!name || !urlOrBase) {
    console.error("Usage: jot register <name> <baseUrl> <token>");
    console.error("       jot register <name> <shareUrl>");
    process.exit(1);
  }

  const config = loadConfig();
  config.instances = config.instances.filter((i) => i.name !== name);

  const shareMatch = urlOrBase.match(/^(https?:\/\/.+)\/s\/([a-z0-9]+)$/i);
  if (shareMatch) {
    config.instances.push({ name, baseUrl: shareMatch[1], shareId: shareMatch[2] });
    saveConfig(config);
    console.log(`Registered shared instance "${name}" at ${shareMatch[1]}`);
  } else {
    if (!token) {
      console.error("Usage: jot register <name> <baseUrl> <token>");
      process.exit(1);
    }
    config.instances.push({ name, baseUrl: urlOrBase, token });
    saveConfig(config);
    console.log(`Registered instance "${name}" at ${urlOrBase}`);
  }
  process.exit(0);
}

if (command === "unregister") {
  const name = args[1];
  if (!name) {
    console.error("Usage: jot unregister <name>");
    process.exit(1);
  }

  const config = loadConfig();
  const before = config.instances.length;
  config.instances = config.instances.filter((i) => i.name !== name);
  if (config.instances.length === before) {
    console.error(`Instance "${name}" not found.`);
    process.exit(1);
  }

  saveConfig(config);
  console.log(`Unregistered instance "${name}".`);
  process.exit(0);
}

if (command === "instances") {
  const config = loadConfig();
  if (config.instances.length === 0) {
    console.log("No registered instances.");
  } else {
    for (const instance of config.instances) {
      console.log(`${instance.name}  ${instance.baseUrl}`);
    }
  }
  process.exit(0);
}

const instanceName = command;
const subCommand = args[1];

if (!subCommand) {
  console.error(`Usage: jot <instance> <command> [args...]`);
  console.error(`Commands: list, search, read, create, edit, delete, update, refresh, destinations, save-to`);
  process.exit(1);
}

const instance = getInstance(instanceName);

if (isShareInstance(instance)) {
  const sid = instance.shareId;
  const plainArgs = args.filter((a) => !a.startsWith("--"));
  const nameArg = args.find((a) => a.startsWith("--name="));
  const agentName = nameArg ? nameArg.split("=").slice(1).join("=") : "Agent";

  switch (subCommand) {
    case "read": {
      const payload = await request(instance, "GET", `/api/share/${sid}/note`);
      const note = payload.note;
      console.log(`# ${note.title}`);
      console.log(`# id: ${note.id}`);
      console.log(`# updated: ${note.updatedAt}`);
      console.log(`# access: ${note.shareAccess}`);
      console.log();
      console.log(note.markdown);

      if (payload.threads && payload.threads.length > 0) {
        console.log();
        console.log("--- Comments ---");
        for (const thread of payload.threads) {
          const anchor = thread.anchor?.quote ? `"${thread.anchor.quote.slice(0, 60)}"` : "(no anchor)";
          console.log();
          console.log(`Thread ${thread.id} on ${anchor}${thread.resolved ? " [resolved]" : ""}`);
          for (const msg of thread.messages) {
            console.log(`  [${msg.id}] ${msg.authorName} (${msg.updatedAt}): ${msg.body}`);
          }
        }
      }
      break;
    }

    case "edit": {
      const editsJson = plainArgs[2];
      if (!editsJson) {
        console.error("Usage: jot <instance> edit '<json edits>'");
        process.exit(1);
      }
      let edits;
      try { edits = JSON.parse(editsJson); } catch { console.error("Invalid JSON."); process.exit(1); }
      const payload = await request(instance, "POST", `/api/share/${sid}/edit`, { edits });
      console.log(`Saved at ${payload.savedAt}`);
      break;
    }

    case "comment": {
      const quote = plainArgs[2];
      const body = plainArgs.slice(3).join(" ");
      if (!quote || !body) {
        console.error('Usage: jot <instance> comment <quote> <body>');
        process.exit(1);
      }
      const payload = await request(instance, "POST", `/api/share/${sid}/threads`, { anchor: { quote, prefix: "", suffix: "", start: 0, end: 0 }, body, name: agentName });
      console.log("Comment added");
      break;
    }

    case "reply": {
      const threadId = plainArgs[2];
      const messageId = plainArgs[3];
      const body = plainArgs.slice(4).join(" ");
      if (!threadId || !messageId || !body) {
        console.error("Usage: jot <instance> reply <threadId> <messageId> <body>");
        process.exit(1);
      }
      await request(instance, "POST", `/api/share/${sid}/threads/${threadId}/replies`, { body, name: agentName, parentMessageId: messageId });
      console.log("Reply added");
      break;
    }

    default:
      console.error(`Unknown command for shared instance: ${subCommand}`);
      console.error("Available: read, edit, comment, reply");
      process.exit(1);
  }
} else {

switch (subCommand) {
  case "list": {
    const payload = await request(instance, "GET", "/api/notes");
    for (const note of payload.notes) {
      console.log(`${note.id}\t${note.title}\t${note.updatedAt}`);
    }
    break;
  }

  case "search": {
    const query = args.slice(2).join(" ");
    if (!query) {
      console.error("Usage: jot <instance> search <query>");
      process.exit(1);
    }
    const payload = await request(instance, "GET", `/api/notes?q=${encodeURIComponent(query)}`);
    for (const note of payload.notes) {
      console.log(`${note.id}\t${note.title}\t${note.updatedAt}`);
    }
    break;
  }

  case "read": {
    const noteId = args[2];
    if (!noteId) {
      console.error("Usage: jot <instance> read <id> [--offset=N] [--limit=M]");
      process.exit(1);
    }

    const offsetArg = args.find((a) => a.startsWith("--offset="));
    const limitArg = args.find((a) => a.startsWith("--limit="));
    const offset = offsetArg ? offsetArg.split("=")[1] : null;
    const limit = limitArg ? limitArg.split("=")[1] : null;

    let endpoint = `/api/notes/${noteId}`;
    const params = [];
    if (offset) params.push(`offset=${offset}`);
    if (limit) params.push(`limit=${limit}`);
    if (params.length) endpoint += `?${params.join("&")}`;

    const payload = await request(instance, "GET", endpoint);
    const note = payload.note;

    if (note.content !== undefined) {
      console.log(`# ${note.title}`);
      console.log(`# id: ${note.id}`);
      console.log(`# lines: ${note.offset}-${note.offset + note.limit - 1} of ${note.totalLines}${note.remaining > 0 ? ` (${note.remaining} more)` : ""}`);
      console.log();
      console.log(note.content);
    } else {
      console.log(`# ${note.title}`);
      console.log(`# id: ${note.id}`);
      console.log(`# updated: ${note.updatedAt}`);
      console.log(`# share: ${note.shareUrl}`);
      console.log();
      console.log(note.markdown);

      if (payload.threads && payload.threads.length > 0) {
        console.log();
        console.log("--- Comments ---");
        for (const thread of payload.threads) {
          const anchor = thread.anchor?.quote ? `"${thread.anchor.quote.slice(0, 60)}"` : "(no anchor)";
          console.log();
          console.log(`Thread ${thread.id} on ${anchor}${thread.resolved ? " [resolved]" : ""}`);
          for (const msg of thread.messages) {
            console.log(`  [${msg.id}] ${msg.authorName} (${msg.updatedAt}): ${msg.body}`);
          }
        }
      }
    }
    break;
  }

  case "create": {
    const title = args.slice(2).join(" ") || "untitled";
    const payload = await request(instance, "POST", "/api/notes");
    if (title !== "untitled") {
      await request(instance, "PUT", `/api/notes/${payload.note.id}`, { title, markdown: "" });
    }
    console.log(`${payload.note.id}\t${title}`);
    break;
  }

  case "comment": {
    const noteId = args[2];
    const quote = args[3];
    const body = args.slice(4).join(" ");
    if (!noteId || !quote || !body) {
      console.error("Usage: jot <instance> comment <id> <quote> <body>");
      console.error('Example: jot myserver comment abc123 "some text" "my comment"');
      process.exit(1);
    }
    const payload = await request(instance, "POST", `/api/notes/${noteId}/threads`, { quote, body });
    console.log(`Comment added (thread ${payload.thread.id})`);
    break;
  }

  case "reply": {
    const noteId = args[2];
    const threadId = args[3];
    const messageId = args[4];
    const body = args.slice(5).join(" ");
    if (!noteId || !threadId || !messageId || !body) {
      console.error("Usage: jot <instance> reply <noteId> <threadId> <messageId> <body>");
      process.exit(1);
    }
    await request(instance, "POST", `/api/notes/${noteId}/threads/${threadId}/replies`, { body, parentMessageId: messageId });
    console.log("Reply added");
    break;
  }

  case "resolve": {
    const noteId = args[2];
    const threadId = args[3];
    if (!noteId || !threadId) {
      console.error("Usage: jot <instance> resolve <noteId> <threadId>");
      process.exit(1);
    }
    await request(instance, "PATCH", `/api/notes/${noteId}/threads/${threadId}`, { resolved: true });
    console.log("Thread resolved");
    break;
  }

  case "reopen": {
    const noteId = args[2];
    const threadId = args[3];
    if (!noteId || !threadId) {
      console.error("Usage: jot <instance> reopen <noteId> <threadId>");
      process.exit(1);
    }
    await request(instance, "PATCH", `/api/notes/${noteId}/threads/${threadId}`, { resolved: false });
    console.log("Thread reopened");
    break;
  }

  case "delete-thread": {
    const noteId = args[2];
    const threadId = args[3];
    if (!noteId || !threadId) {
      console.error("Usage: jot <instance> delete-thread <noteId> <threadId>");
      process.exit(1);
    }
    await request(instance, "DELETE", `/api/notes/${noteId}/threads/${threadId}`);
    console.log("Thread deleted");
    break;
  }

  case "edit-comment": {
    const noteId = args[2];
    const messageId = args[3];
    const body = args.slice(4).join(" ");
    if (!noteId || !messageId || !body) {
      console.error("Usage: jot <instance> edit-comment <noteId> <messageId> <body>");
      process.exit(1);
    }
    await request(instance, "PATCH", `/api/notes/${noteId}/messages/${messageId}`, { body });
    console.log("Comment edited");
    break;
  }

  case "delete-comment": {
    const noteId = args[2];
    const messageId = args[3];
    if (!noteId || !messageId) {
      console.error("Usage: jot <instance> delete-comment <noteId> <messageId>");
      process.exit(1);
    }
    await request(instance, "DELETE", `/api/notes/${noteId}/messages/${messageId}`);
    console.log("Comment deleted");
    break;
  }

  case "edit": {
    const noteId = args[2];
    const editsJson = args[3];
    if (!noteId || !editsJson) {
      console.error("Usage: jot <instance> edit <id> '<json edits>'");
      console.error('Example: jot myserver edit abc123 \'[{"oldText":"hello","newText":"world"}]\'');
      process.exit(1);
    }

    let edits;
    try {
      edits = JSON.parse(editsJson);
    } catch {
      console.error("Invalid JSON for edits.");
      process.exit(1);
    }

    const payload = await request(instance, "POST", `/api/notes/${noteId}/edit`, { edits });
    console.log(`Saved at ${payload.savedAt}`);
    break;
  }

  case "share": {
    const noteId = args[2];
    const access = args[3];
    if (!noteId) {
      console.error("Usage: jot <instance> share <id> [none|view|comment|edit]");
      process.exit(1);
    }
    if (!access) {
      const payload = await request(instance, "GET", `/api/notes/${noteId}`);
      const note = payload.note;
      console.log(`${note.id}\t${note.shareAccess}\t${note.shareUrl}`);
      break;
    }
    if (!["none", "view", "comment", "edit"].includes(access)) {
      console.error("Access must be one of: none, view, comment, edit");
      process.exit(1);
    }
    const sharePayload = await request(instance, "PUT", `/api/notes/${noteId}`, { shareAccess: access });
    const readPayload = await request(instance, "GET", `/api/notes/${noteId}`);
    console.log(`${noteId}\t${readPayload.note.shareAccess}\t${readPayload.note.shareUrl}`);
    break;
  }

  case "update": {
    const noteId = args[2];
    const field = args[3];
    const rest = args.slice(4);
    const fileFlagIdx = rest.findIndex((a) => a === "--file");
    let value;
    if (fileFlagIdx !== -1) {
      const filePath = rest[fileFlagIdx + 1];
      if (!filePath) {
        console.error("--file requires a path (or '-' for stdin)");
        process.exit(1);
      }
      if (filePath === "-") {
        value = fs.readFileSync(0, "utf8");
      } else {
        try {
          value = fs.readFileSync(filePath, "utf8");
        } catch (err) {
          console.error(`Could not read ${filePath}: ${err.message}`);
          process.exit(1);
        }
      }
    } else {
      value = rest.join(" ");
    }
    if (!noteId || !field || (fileFlagIdx === -1 && !value)) {
      console.error("Usage: jot <instance> update <id> title <value>");
      console.error("       jot <instance> update <id> markdown <value>");
      console.error("       jot <instance> update <id> markdown --file <path|- for stdin>");
      process.exit(1);
    }

    const body = {};
    if (field === "title") {
      body.title = value;
      body.markdown = undefined;
      const current = await request(instance, "GET", `/api/notes/${noteId}`);
      body.markdown = current.note.markdown;
    } else if (field === "markdown") {
      body.markdown = value;
      const current = await request(instance, "GET", `/api/notes/${noteId}`);
      body.title = current.note.title;
    } else {
      console.error(`Unknown field: ${field}. Use 'title' or 'markdown'.`);
      process.exit(1);
    }

    const payload = await request(instance, "PUT", `/api/notes/${noteId}`, body);
    console.log(`Saved at ${payload.savedAt}`);
    break;
  }

  case "delete": {
    const noteId = args[2];
    if (!noteId) {
      console.error("Usage: jot <instance> delete <id>");
      process.exit(1);
    }
    await request(instance, "DELETE", `/api/notes/${noteId}`);
    console.log(`Deleted ${noteId}`);
    break;
  }

  case "refresh": {
    const noteId = args[2];
    if (!noteId) {
      console.error("Usage: jot <instance> refresh <id> [message]");
      process.exit(1);
    }
    const message = args.slice(3).join(" ").trim() || undefined;
    await request(instance, "POST", `/api/notes/${noteId}/refresh`, message ? { message } : {});
    console.log(message ? `Refreshed ${noteId}: ${message}` : `Refreshed ${noteId}`);
    break;
  }

  case "destinations": {
    const payload = await request(instance, "GET", "/api/destinations");
    if (!payload.destinations || payload.destinations.length === 0) {
      console.log("(no destinations configured)");
      break;
    }
    for (const d of payload.destinations) {
      console.log(`${d.id}\t${d.label}\t${d.kind}`);
    }
    break;
  }

  case "save-to": {
    const noteId = args[2];
    const destId = args[3];
    if (!noteId || !destId) {
      console.error("Usage: jot <instance> save-to <id> <destinationId>");
      process.exit(1);
    }
    const payload = await request(instance, "POST", `/api/notes/${noteId}/save-to/${encodeURIComponent(destId)}`);
    console.log(`Saved to ${payload.destination}: ${payload.path}`);
    break;
  }

  case "revisions": {
    const noteId = args[2];
    if (!noteId) {
      console.error("Usage: jot <instance> revisions <id> [--diff <revId> | --show <revId> | --restore <revId>] [--author <name>] [--limit N]");
      process.exit(1);
    }
    const rest = args.slice(3);
    const diffIdx = rest.findIndex((a) => a === "--diff");
    const showIdx = rest.findIndex((a) => a === "--show");
    const restoreIdx = rest.findIndex((a) => a === "--restore");
    const authorIdx = rest.findIndex((a) => a === "--author");
    const limitIdx = rest.findIndex((a) => a === "--limit");

    if (diffIdx !== -1) {
      const revId = rest[diffIdx + 1];
      if (!revId) { console.error("--diff requires a revision id"); process.exit(1); }
      const payload = await request(instance, "GET", `/api/notes/${noteId}/revisions/${encodeURIComponent(revId)}`);
      printUnifiedDiff(payload.revision, payload.currentMarkdown);
      break;
    }
    if (showIdx !== -1) {
      const revId = rest[showIdx + 1];
      if (!revId) { console.error("--show requires a revision id"); process.exit(1); }
      const payload = await request(instance, "GET", `/api/notes/${noteId}/revisions/${encodeURIComponent(revId)}`);
      process.stdout.write(payload.revision.body);
      if (!payload.revision.body.endsWith("\n")) process.stdout.write("\n");
      break;
    }
    if (restoreIdx !== -1) {
      const revId = rest[restoreIdx + 1];
      if (!revId) { console.error("--restore requires a revision id"); process.exit(1); }
      const payload = await request(instance, "POST", `/api/notes/${noteId}/revisions/${encodeURIComponent(revId)}/restore`);
      console.log(`Restored from ${payload.restoredFrom} at ${payload.savedAt}`);
      break;
    }

    const params = new URLSearchParams();
    if (authorIdx !== -1 && rest[authorIdx + 1]) params.set("author", rest[authorIdx + 1]);
    if (limitIdx !== -1 && rest[limitIdx + 1]) params.set("limit", rest[limitIdx + 1]);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const payload = await request(instance, "GET", `/api/notes/${noteId}/revisions${qs}`);
    if (!payload.revisions || payload.revisions.length === 0) {
      console.log("(no revisions yet)");
      break;
    }
    for (const r of payload.revisions) {
      const reason = r.reason ? `\t(${r.reason})` : "";
      console.log(`${r.id}\t${r.ts}\t${r.author_name}\t${r.body_size}B${reason}\t${r.title}`);
    }
    break;
  }

  default:
    console.error(`Unknown command: ${subCommand}`);
    printUsage();
    process.exit(1);
}

} // end owner mode

function printUsage() {
  console.log(`Usage: jot <command> [args...]

Server:
  jot serve [--port=N] [--data=path]      Run the jot server

Instance management:
  jot register <name> <baseUrl> <token>   Register with API key (owner)
  jot register <name> <shareUrl>          Register with share link
  jot unregister <name>                   Remove a registered instance
  jot instances                           List registered instances

Owner commands:
  jot <instance> list                     List all notes
  jot <instance> search <query>           Search notes
  jot <instance> read <id>                Read a note with comments
  jot <instance> create [title]           Create a new note
  jot <instance> share <id> [access]      Get/set share access (none|view|comment|edit)
  jot <instance> comment <id> <quote> <b> Comment on quoted text
  jot <instance> reply <id> <tid> <mid> b  Reply to a specific message
  jot <instance> resolve <id> <tid>        Resolve a thread
  jot <instance> reopen <id> <tid>         Reopen a thread
  jot <instance> edit-comment <id> <mid> b Edit a comment
  jot <instance> delete-comment <id> <mid> Delete a comment
  jot <instance> delete-thread <id> <tid>  Delete a thread
  jot <instance> edit <id> '<edits>'       Apply edits (JSON array of {oldText, newText})
  jot <instance> update <id> title <val>   Update note title
  jot <instance> update <id> markdown <v>  Replace full markdown
  jot <instance> update <id> markdown --file <path>  Read body from file (use '-' for stdin)
  jot <instance> delete <id>               Delete a note
  jot <instance> refresh <id> [message]    Nudge open browsers to reload this note
  jot <instance> destinations              List configured save destinations
  jot <instance> save-to <id> <destId>     Save note markdown to a destination
  jot <instance> revisions <id>            List revision history (id, ts, author, size, reason, title)
  jot <instance> revisions <id> --diff <revId>     Print unified diff of revId vs current
  jot <instance> revisions <id> --show <revId>     Print body at revId to stdout
  jot <instance> revisions <id> --restore <revId>  Restore note to revId (creates new revision)
  jot <instance> revisions <id> [--author <name>] [--limit N]   Filter the list

Shared note commands:
  jot <instance> read                     Read the shared note
  jot <instance> edit '<edits>'           Edit (if edit access)
  jot <instance> comment <quote> <body>   Comment on text
  jot <instance> reply <tid> <mid> <body> Reply to a specific message
  Use --name="Name" to set display name for comments`);
}
