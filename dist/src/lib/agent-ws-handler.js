"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAgentConnection = handleAgentConnection;
const agent_registry_js_1 = require("./agent-registry.js");
const AGENT_TOKENS = (process.env.AGENT_TOKENS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
function send(ws, msg) {
    try {
        ws.send(JSON.stringify(msg));
    }
    catch {
        // connection closed
    }
}
function handleAgentConnection(ws, _req) {
    let agentId = null;
    let authenticated = false;
    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        }
        catch {
            return;
        }
        if (!authenticated) {
            if (msg.type !== 'auth') {
                send(ws, { type: 'auth_error', message: 'Expected auth message first' });
                ws.close();
                return;
            }
            // Validate token
            if (!AGENT_TOKENS.includes(msg.token)) {
                console.warn(`[agent-ws] Auth failed for agentId=${msg.agentId} — invalid token`);
                send(ws, { type: 'auth_error', message: 'Invalid token' });
                ws.close();
                return;
            }
            agentId = msg.agentId;
            authenticated = true;
            agent_registry_js_1.registry.register(ws, {
                agentId: msg.agentId,
                name: msg.name,
                version: msg.version,
                token: msg.token,
            });
            send(ws, { type: 'auth_ok' });
            console.log(`[agent-ws] Agent connected: "${msg.name}" (${msg.agentId})`);
            return;
        }
        if (msg.type === 'snapshot') {
            if (agentId)
                agent_registry_js_1.registry.update(agentId, msg.data);
            send(ws, { type: 'ack' });
        }
        else if (msg.type === 'ping') {
            send(ws, { type: 'pong' });
        }
    });
    ws.on('close', () => {
        if (agentId) {
            agent_registry_js_1.registry.disconnect(agentId);
            console.log(`[agent-ws] Agent disconnected: ${agentId}`);
        }
    });
    ws.on('error', (err) => {
        console.warn(`[agent-ws] Error for ${agentId ?? 'unknown'}:`, err.message);
    });
}
