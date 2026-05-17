#!/usr/bin/env node
/**
 * backchannel-poller.js
 * 
 * Watches walkie channel for LLM responses and posts them back to Jot.
 * 
 * Usage: node backchannel-poller.js [--channel=jot-comments]
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Configuration
const CHANNEL = process.env.WALKIE_CHANNEL || "jot-comments";
const BOT_ID = process.env.WALKIE_ID || "jot-bot";
const JOT_CONFIG = path.join(os.homedir(), ".config", "jot", "settings.json");

// Parse JOT_REPLY format from messages
// Format: JOT_REPLY:<noteId>:<threadId>:<messageId>:<body>
const REPLY_PATTERN = /^JOT_REPLY:([a-zA-Z0-9]+):([a-zA-Z0-9]+):([a-zA-Z0-9]+):(.*)$/;

// Read Jot CLI path and instance from config
function getJotCli() {
  try {
    const config = JSON.parse(readFileSync(JOT_CONFIG, "utf8"));
    const instance = config.instances?.[0];
    if (!instance) return null;
    return {
      cli: path.join(os.homedir(), "PROJECTS", "jot", "cli", "jot.mjs"),
      instance: instance.name,
    };
  } catch {
    return {
      cli: path.join(os.homedir(), "PROJECTS", "jot", "cli", "jot.mjs"),
      instance: "local",
    };
  }
}

// Post reply to Jot
function postReply(noteId, threadId, messageId, body) {
  return new Promise((resolve, reject) => {
    const jot = getJotCli();
    
    const args = [
      jot.cli,
      jot.instance,
      "reply",
      noteId,
      threadId,
      messageId,
      body,
    ];
    
    console.log(`[jot-reply] posting to ${noteId}/${threadId}/${messageId}: ${body.slice(0, 50)}...`);
    
    const proc = spawn("node", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    
    let stdout = "";
    let stderr = "";
    
    proc.stdout?.on("data", (d) => { stdout += d; });
    proc.stderr?.on("data", (d) => { stderr += d; });
    
    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`[jot-reply] success`);
        resolve(stdout);
      } else {
        console.error(`[jot-reply] failed: ${stderr}`);
        reject(new Error(stderr || `exit ${code}`));
      }
    });
    
    proc.on("error", reject);
    
    // Timeout after 15 seconds
    setTimeout(() => {
      proc.kill();
      reject(new Error("jot reply timeout"));
    }, 15000);
  });
}

// Parse walkie message format
// Messages look like: "jot-bot: message" or just "message"
function parseMessage(line) {
  // Skip own messages
  if (line.startsWith(`${BOT_ID}:`)) return null;
  if (line.startsWith(`[${BOT_ID}]`)) return null;
  
  // Check for JOT_REPLY format
  const match = line.match(REPLY_PATTERN);
  if (!match) return null;
  
  return {
    noteId: match[1],
    threadId: match[2],
    messageId: match[3],
    body: match[4],
  };
}

// Main poller using walkie watch --exec
function startPoller() {
  console.log(`[poller] starting on channel: ${CHANNEL} (identity: ${BOT_ID})`);
  
  const proc = spawn("walkie", ["watch", CHANNEL, "--exec", "node", "-e", `
    const msg = process.env.WALKIE_MSG || "";
    const from = process.env.WALKIE_FROM || "";
    const botId = "${BOT_ID}";
    
    // Skip own messages
    if (from === botId) { process.exit(0); }
    
    // Look for JOT_REPLY: pattern
    const match = msg.match(/^JOT_REPLY:([a-zA-Z0-9]+):([a-zA-Z0-9]+):([a-zA-Z0-9]+):(.*)$/);
    if (match) {
      console.log(JSON.stringify({ noteId: match[1], threadId: match[2], messageId: match[3], body: match[4] }));
    }
  `], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WALKIE_ID: BOT_ID },
  });
  
  let buffer = "";
  
  proc.stdout?.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Try to parse JSON response from exec
      try {
        const parsed = JSON.parse(line);
        if (parsed.noteId && parsed.threadId && parsed.messageId && parsed.body) {
          console.log(`[poller] detected reply for ${parsed.noteId}/${parsed.threadId}`);
          postReply(parsed.noteId, parsed.threadId, parsed.messageId, parsed.body)
            .catch((err) => console.error(`[poller] reply failed: ${err.message}`));
        }
      } catch {
        // Not JSON, log raw
        if (line.includes("WALKIE_MSG")) continue;
        console.log(`[poller] raw: ${line.slice(0, 100)}`);
      }
    }
  });
  
  proc.stderr?.on("data", (d) => {
    const err = d.toString();
    if (!err.includes("debug")) {
      console.error(`[poller] stderr: ${err.slice(0, 200)}`);
    }
  });
  
  proc.on("close", (code) => {
    console.error(`[poller] walkie exited with code ${code}, restarting in 5s...`);
    setTimeout(startPoller, 5000);
  });
  
  proc.on("error", (err) => {
    console.error(`[poller] error: ${err.message}, retrying in 5s...`);
    setTimeout(startPoller, 5000);
  });
}

// Alternative: simple polling mode
function startSimplePoller() {
  console.log(`[simple-poller] starting on channel: ${CHANNEL} (identity: ${BOT_ID})`);
  
  const proc = spawn("walkie", ["read", CHANNEL, "--wait"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WALKIE_ID: BOT_ID },
  });
  
  let buffer = "";
  
  proc.stdout?.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    
    for (const line of lines) {
      const reply = parseMessage(line);
      if (reply) {
        console.log(`[poller] detected reply for ${reply.noteId}/${reply.threadId}`);
        postReply(reply.noteId, reply.threadId, reply.messageId, reply.body)
          .catch((err) => console.error(`[poller] reply failed: ${err.message}`));
      }
    }
  });
  
  proc.stderr?.on("data", (d) => {
    const err = d.toString();
    if (!err.includes("debug") && err.trim()) {
      console.error(`[poller] stderr: ${err.slice(0, 200)}`);
    }
  });
  
  proc.on("close", (code) => {
    console.log(`[poller] read exited, restarting in 2s...`);
    setTimeout(startSimplePoller, 2000);
  });
  
  proc.on("error", (err) => {
    console.error(`[poller] error: ${err.message}, retrying in 5s...`);
    setTimeout(startSimplePoller, 5000);
  });
}

// Try watch mode first, fall back to read mode
console.log(`[backchannel-poller] starting...`);
console.log(`[backchannel-poller] channel: ${CHANNEL}`);
console.log(`[backchannel-poller] identity: ${BOT_ID}`);

// Start with simple read poller (more reliable)
startSimplePoller();

// Graceful shutdown
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));