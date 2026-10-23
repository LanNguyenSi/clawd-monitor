// Must stay the first import: it loads .env / .env.local into process.env
// before the modules below read their configuration at load time.
import './src/lib/env-bootstrap.js'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer } from 'ws'
import { handleAgentConnection } from './src/lib/agent-ws-handler.js'
import { attachUpgradeRouter } from './src/lib/ws-upgrade.js'

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT ?? '3000')
const hostname = process.env.HOSTNAME ?? '0.0.0.0'

// Validate critical config at startup
if (!dev) {
  const missing: string[] = []
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET')
  if (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH) missing.push('ADMIN_PASSWORD or ADMIN_PASSWORD_HASH')
  if (missing.length > 0) {
    console.error(`[startup] Missing required env vars in production: ${missing.join(', ')}`)
    process.exit(1)
  }
} else {
  if (!process.env.JWT_SECRET) console.warn('[startup] JWT_SECRET not set — using insecure dev default')
  if (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH) console.warn('[startup] No admin password configured — using dev default "admin"')
  if (!process.env.AGENT_TOKENS) console.warn('[startup] AGENT_TOKENS not set — agents cannot connect without UI-created tokens')
}

// Next attaches its own `upgrade` listener to the first server it serves a
// request for; that listener ends /api/agents/ws (it matches the dynamic route
// /api/agents/[agentId]). Give it a server that never listens so the real
// server has exactly one upgrade listener, ours (see ws-upgrade.ts).
const nextServer = createServer()
const app = next({ dev, hostname, port, httpServer: nextServer })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true)
    void handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', handleAgentConnection)

  // In dev, other upgrades (HMR) are replayed on the server Next listens on;
  // its own listener, attached on the first request, handles them. (The
  // public app.getUpgradeHandler() is a no-op for HMR.) Production has no
  // upgrade use for Next, so there other upgrades are destroyed.
  attachUpgradeRouter(
    server,
    wss,
    dev
      ? (req, socket, head) => {
          if (!nextServer.emit('upgrade', req, socket, head)) socket.destroy()
        }
      : null,
  )

  server.listen(port, hostname, () => {
    console.log(`> clawd-monitor ready on http://${hostname}:${port}`)
    console.log(`> Agent WebSocket: ws://${hostname}:${port}/api/agents/ws`)
  })
})
