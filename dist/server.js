"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const url_1 = require("url");
const next_1 = __importDefault(require("next"));
const ws_1 = require("ws");
const agent_ws_handler_js_1 = require("./src/lib/agent-ws-handler.js");
const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT ?? '3000');
const hostname = process.env.HOSTNAME ?? '0.0.0.0';
const app = (0, next_1.default)({ dev, hostname, port });
const handle = app.getRequestHandler();
app.prepare().then(() => {
    const server = (0, http_1.createServer)((req, res) => {
        const parsedUrl = (0, url_1.parse)(req.url ?? '/', true);
        void handle(req, res, parsedUrl);
    });
    const wss = new ws_1.WebSocketServer({ noServer: true });
    wss.on('connection', agent_ws_handler_js_1.handleAgentConnection);
    server.on('upgrade', (req, socket, head) => {
        const { pathname } = (0, url_1.parse)(req.url ?? '/');
        if (pathname === '/api/agents/ws') {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        }
        else {
            socket.destroy();
        }
    });
    server.listen(port, hostname, () => {
        console.log(`> clawd-monitor ready on http://${hostname}:${port}`);
        console.log(`> Agent WebSocket: ws://${hostname}:${port}/api/agents/ws`);
    });
});
