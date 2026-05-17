#!/usr/bin/env node
// jot-to-peers.mjs — single-script bridge for jot comments → Claude Code sessions.
//
// Replaces webhook-receiver.js + backchannel-poller.js + the walkie agent
// "--cli claude" approach. Routes directly to an EXISTING CC session via
// claude-peers so the receiving Claude has full project context (vs spawning
// a fresh, context-less claude per event).
//
// Trigger convention (matches the architecture jot rj3vxfzw):
//   [?]        → HOT — deliver to peer
//   anything   → WARM/COLD — log and skip
//
// Reply path: the receiving Claude replies via `jot local reply` directly
// from its session — no return-side poller needed.
//
// Env:
//   JOT_TO_PEERS_PORT       default 7891
//   JOT_TO_PEERS_TARGET     default the hardcoded mise-spring CC peer ID
//   CLAUDE_PEERS_PORT       default 7899

import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.JOT_TO_PEERS_PORT || 7891);
const TARGET_PEER = process.env.JOT_TO_PEERS_TARGET || "27f7a3ol";
const PEERS_CLI = "/Users/soderstrom/mcp/claude-peers-mcp/cli.ts";
const PEERS_PORT = process.env.CLAUDE_PEERS_PORT || "7899";

function log(...args) {
  console.log(`[jot-to-peers ${new Date().toISOString()}]`, ...args);
}

function deliverToPeer(toId, message) {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [PEERS_CLI, "send", toId, message], {
      env: { ...process.env, CLAUDE_PEERS_PORT: PEERS_PORT },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr || `bun exited ${code}`)),
    );
  });
}

function formatForClaude(p) {
  const url = `http://localhost:3210/n/${p.noteId}`;
  const who = p.authorName || "someone";
  const quoteLine = p.quote ? `\n> ${p.quote.trim()}` : "";
  const body = (p.body || "").trim();
  const ids = `note=${p.noteId} thread=${p.threadId || "?"}`;
  return (
    `[jot comment from ${who} on "${p.noteTitle}"]\n` +
    `${url}${quoteLine}\n\n` +
    `${body}\n\n` +
    `To reply in the same thread:\n` +
    `  node ~/PROJECTS/jot/cli/jot.mjs local reply ${p.noteId} ${p.threadId} <messageId> "<your reply>"\n` +
    `(messageId is in the [bracket] before the author in the comment dump — read with: jot local read ${p.noteId})\n\n` +
    `Refs: ${ids}`
  );
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404).end("not found");
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      log("bad json:", e.message);
      res.writeHead(400).end("bad json");
      return;
    }

    const body = (payload.body || "").trim();
    // Loop guard: skip replies authored by Claude (containing the [bot] tag)
    if (payload.authorName === "jot-bot" || body.startsWith("[bot]")) {
      log(`skip (loop guard): author=${payload.authorName}`);
      res.writeHead(200).end("skipped (loop guard)");
      return;
    }

    if (!body.startsWith("[?]")) {
      log(`skip (no hot trigger): event=${payload.event} body="${body.slice(0, 60)}"`);
      res.writeHead(200).end("skipped (warm/cold)");
      return;
    }

    try {
      await deliverToPeer(TARGET_PEER, formatForClaude(payload));
      log(`sent → ${TARGET_PEER} (note ${payload.noteId} event ${payload.event})`);
      res.writeHead(200).end("delivered");
    } catch (e) {
      log("deliver failed:", e.message);
      res.writeHead(502).end(`deliver failed: ${e.message}`);
    }
  });
});

server.listen(PORT, () => {
  log(`listening on :${PORT}  →  peer ${TARGET_PEER}`);
});
