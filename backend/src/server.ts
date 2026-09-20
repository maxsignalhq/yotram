import http from 'node:http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { WorkspaceFs } from './fs.js';
import { PtyManager } from './pty.js';
import { isClientMessage, ServerMessage } from './protocol.js';

export function createServer(rootDir: string): { httpServer: http.Server; close: () => void } {
  const app = express();
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer });
  const workspaceFs = new WorkspaceFs(rootDir);
  const ptyManager = new PtyManager();

  const unwatch = workspaceFs.watch((event) => {
    broadcast({ type: 'fs:watch-event', path: event.path, kind: event.kind });
  });

  function broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!isClientMessage(parsed)) return;

      switch (parsed.type) {
        case 'fs:list': {
          try {
            const entries = await workspaceFs.list(parsed.path);
            ws.send(JSON.stringify({ type: 'fs:list', path: parsed.path, entries }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'fs:error', path: parsed.path, message: (err as Error).message }));
          }
          break;
        }
        case 'fs:read': {
          try {
            const content = await workspaceFs.read(parsed.path);
            ws.send(JSON.stringify({ type: 'fs:read', path: parsed.path, content }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'fs:error', path: parsed.path, message: (err as Error).message }));
          }
          break;
        }
        case 'fs:write': {
          try {
            await workspaceFs.write(parsed.path, parsed.content);
          } catch (err) {
            ws.send(JSON.stringify({ type: 'fs:error', path: parsed.path, message: (err as Error).message }));
          }
          break;
        }
        case 'pty:create': {
          ptyManager.create(
            parsed.sessionId,
            parsed.cols,
            parsed.rows,
            (data) => ws.send(JSON.stringify({ type: 'pty:data', sessionId: parsed.sessionId, data })),
            (exitCode) => ws.send(JSON.stringify({ type: 'pty:exit', sessionId: parsed.sessionId, exitCode })),
          );
          break;
        }
        case 'pty:data': {
          ptyManager.write(parsed.sessionId, parsed.data);
          break;
        }
        case 'pty:resize': {
          ptyManager.resize(parsed.sessionId, parsed.cols, parsed.rows);
          break;
        }
      }
    });
  });

  return {
    httpServer,
    close: () => {
      unwatch();
      wss.close();
      httpServer.close();
    },
  };
}
