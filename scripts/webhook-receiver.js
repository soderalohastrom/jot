#!/usr/bin/env node
/**
 * webhook-receiver.js
 * 
 * Receives Jot comment webhooks and forwards them to walkie channel.
 * 
 * Usage: node webhook-receiver.js [--port=7891]
 */

import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 7891);

// Parse hot trigger from comment body
function isHotComment(body) {
  return /^\[?\]?\?/.test(body || "");
}

// Format message for walkie channel
function formatWalkieMessage(payload) {
  const parts = [];
  parts.push(`[${payload.event}]`);
  parts.push(`On "${payload.noteTitle}" (${payload.noteId}):`);
  if (payload.quote) {
    parts.push(`Quote: "${payload.quote}"`);
  }
  if (payload.body) {
    parts.push(`Comment: ${payload.body}`);
  }
  if (payload.authorName) {
    parts.push(`— ${payload.authorName}`);
  }
  return parts.join("\n");
}

// Send to walkie channel
function sendToWalkie(message) {
  return new Promise((resolve, reject) => {
    const walkie = spawn("walkie", ["send", "jot-comments", message], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    
    let stdout = "";
    let stderr = "";
    
    walkie.stdout?.on("data", (d) => { stdout += d; });
    walkie.stderr?.on("data", (d) => { stderr += d; });
    
    walkie.on("close", (code) => {
      if (code === 0) {
        console.log(`[walkie] sent: ${message.slice(0, 80)}...`);
        resolve(stdout);
      } else {
        console.error(`[walkie] error: ${stderr || `exit ${code}`}`);
        reject(new Error(stderr || `exit ${code}`));
      }
    });
    
    walkie.on("error", (err) => {
      console.error(`[walkie] spawn error: ${err.message}`);
      reject(err);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      walkie.kill();
      reject(new Error("walkie timeout"));
    }, 10000);
  });
}

// Parse JSON safely
function safeJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// Parse query params from URL
function parseQuery(urlStr) {
  try {
    const url = new URL(urlStr, "http://localhost");
    return Object.fromEntries(url.searchParams);
  } catch {
    return {};
  }
}

// HTTP server
const server = http.createServer(async (req, res) => {
  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // POST webhook endpoint
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    
    req.on("data", (chunk) => { body += chunk; });
    
    req.on("end", async () => {
      const payload = safeJson(body);
      
      if (!payload) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }

      console.log(`[webhook] event=${payload.event} noteId=${payload.noteId} threadId=${payload.threadId || "new"}`);

      // Only forward hot comments ([?] trigger)
      if (payload.body && !isHotComment(payload.body)) {
        console.log(`[webhook] skipping (not hot comment): ${payload.body.slice(0, 50)}...`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, skipped: true }));
        return;
      }

      try {
        const message = formatWalkieMessage(payload);
        await sendToWalkie(message);
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, forwarded: true }));
      } catch (err) {
        console.error(`[webhook] forward failed: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    
    return;
  }

  // 404 everything else
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`[webhook-receiver] listening on http://localhost:${PORT}`);
  console.log(`[webhook-receiver] forward to walkie channel: jot-comments`);
  console.log(`[webhook-receiver] test with: curl -X POST http://localhost:${PORT}/webhook -H "Content-Type: application/json" -d '{"event":"test","noteId":"xxx","noteTitle":"test"}'`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});