import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer } from 'ws'
import { handleAgentConnection } from './src/lib/agent-ws-handler.js'

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

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true)
    void handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', handleAgentConnection)

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '/')
    if (pathname === '/api/agents/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    } else {
      socket.destroy()
    }
  })

  server.listen(port, hostname, () => {
    console.log(`> clawd-monitor ready on http://${hostname}:${port}`)
    console.log(`> Agent WebSocket: ws://${hostname}:${port}/api/agents/ws`)
  })
})
