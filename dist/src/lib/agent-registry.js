"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registry = void 0;
const AGENT_TTL_MS = parseInt(process.env.AGENT_TTL_MS ?? '300000');
class AgentRegistry {
    agents = new Map();
    register(ws, meta) {
        const existing = this.agents.get(meta.agentId);
        if (existing) {
            // Reconnect — close old ws if still open
            try {
                existing.ws.close();
            }
            catch { }
        }
        this.agents.set(meta.agentId, {
            ...meta,
            connectedAt: Date.now(),
            lastSnapshotAt: 0,
            lastSnapshot: null,
            online: true,
            ws,
        });
    }
    update(agentId, snapshot) {
        const entry = this.agents.get(agentId);
        if (!entry)
            return;
        entry.lastSnapshot = snapshot;
        entry.lastSnapshotAt = Date.now();
    }
    disconnect(agentId) {
        const entry = this.agents.get(agentId);
        if (!entry)
            return;
        entry.online = false;
    }
    getAll() {
        this.cleanup();
        return Array.from(this.agents.values()).map(({ ws: _ws, token: _token, ...rest }) => rest);
    }
    getAgent(agentId) {
        const entry = this.agents.get(agentId);
        if (!entry)
            return null;
        const { ws: _ws, token: _token, ...rest } = entry;
        return rest;
    }
    cleanup() {
        const now = Date.now();
        for (const [id, entry] of this.agents.entries()) {
            if (!entry.online && now - entry.lastSnapshotAt > AGENT_TTL_MS) {
                this.agents.delete(id);
            }
        }
    }
}
// Singleton — persists across Next.js hot reloads in dev
const globalForRegistry = globalThis;
exports.registry = globalForRegistry.agentRegistry ?? new AgentRegistry();
if (process.env.NODE_ENV !== 'production')
    globalForRegistry.agentRegistry = exports.registry;
