import type { IncomingMessage, Server } from 'http'
import type { Duplex } from 'stream'
import { parse } from 'url'
import type { WebSocketServer } from 'ws'

export const AGENT_WS_PATH = '/api/agents/ws'

type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => unknown

/**
 * Single owner of the `upgrade` event of the real HTTP server.
 *
 * Next's custom-server wrapper attaches its own `upgrade` listener to
 * whichever server serves the first request, and that listener resolves
 * `/api/agents/ws` to the dynamic route `/api/agents/[agentId]` and ends the
 * socket. Next must therefore be given a different (never listening) server
 * through its `httpServer` option, and this function is the only upgrade
 * listener on the real one: the agent path goes to `wss`, everything else is
 * handed to `nextUpgrade` (dev HMR) or, when there is none, destroyed.
 */
export function attachUpgradeRouter(
  server: Server,
  wss: WebSocketServer,
  nextUpgrade: UpgradeHandler | null,
): void {
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '/')
    if (pathname === AGENT_WS_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
      return
    }
    if (!nextUpgrade) {
      socket.destroy()
      return
    }
    Promise.resolve(nextUpgrade(req, socket, head)).catch(() => socket.destroy())
  })
}
