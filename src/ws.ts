import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';

let wss: WebSocketServer | null = null;

export type WsEvent =
  | { type: 'readings'; data: unknown }
  | { type: 'alarm'; data: unknown }
  | { type: 'control'; data: unknown }
  | { type: 'gateway'; data: unknown };

/** Attach a WebSocket server at /ws on the given HTTP server. */
export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'hello', data: { ts: new Date().toISOString() } }));
  });
}

/** Push an event to every connected dashboard client. */
export function broadcast(event: WsEvent): void {
  if (!wss) return;
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}
