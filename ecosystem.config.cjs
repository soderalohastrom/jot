// PM2 process manifest — jot + the comment→CC bridge.
//
// Start both:    cd ~/PROJECTS/jot && pm2 start ecosystem.config.cjs
// Reload one:    pm2 reload jot   |   pm2 reload jot-to-peers
// Stop all:      pm2 stop ecosystem.config.cjs
//
// MiniMax's webhook-receiver.js + backchannel-poller.js are intentionally
// NOT in this manifest — the single bridge replaces both. Leaving the
// files on disk as historical reference; safe to delete.

module.exports = {
  apps: [
    {
      name: "jot",
      cwd: "/Users/soderstrom/PROJECTS/jot",
      script: "node_modules/.bin/tsx",
      args: "src/server.ts --port=3210 --data=/Users/soderstrom/PROJECTS/jot/data",
      env: {
        JOT_WEBHOOK_URL: "http://localhost:7891/webhook",
      },
      max_restarts: 5,
      restart_delay: 2000,
    },
    {
      name: "jot-to-peers",
      cwd: "/Users/soderstrom/PROJECTS/jot",
      script: "scripts/jot-to-peers.mjs",
      env: {
        JOT_TO_PEERS_PORT: "7891",
        JOT_TO_PEERS_TARGET: "27f7a3ol", // CC session in mise-spring
        CLAUDE_PEERS_PORT: "7899",
      },
      max_restarts: 5,
      restart_delay: 2000,
    },
  ],
};
