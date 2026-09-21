import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { Workspaces } from './workspaces.js';
import { WorkspaceFs } from './fs.js';
import { PtyManager } from './pty.js';
import { isClientMessage, ServerMessage } from './protocol.js';
import { Auth, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from './auth.js';

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { result[key] = decodeURIComponent(value); }
    catch { result[key] = value; }
  }
  return result;
}

function serializeSessionCookie(token: string): string {
  const maxAgeSeconds = Math.floor(SESSION_MAX_AGE_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

const LOGIN_PAGE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Yotram — Sign in</title></head>
<body>
  <main style="max-width: 320px; margin: 20vh auto; font-family: sans-serif;">
    <h1>Yotram</h1>
    <form id="login">
      <input type="password" name="password" placeholder="Password" autofocus required />
      <button type="submit">Sign in</button>
    </form>
    <p id="error" role="alert"></p>
  </main>
  <script>
    document.getElementById('login').addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = event.target.password.value;
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) { window.location.href = '/'; return; }
      const result = await response.json();
      document.getElementById('error').textContent = result.error ?? 'Sign in failed';
    });
  </script>
</body>
</html>`;

export function createServer(rootDir: string, options: { password: string }): { httpServer: http.Server; close: () => void } {
  const app = express();
  const workspaces = new Workspaces(rootDir);
  const auth = new Auth(options.password);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) { res.status(403).json({ error: 'Origin not allowed' }); return; }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.post('/api/login', (req, res) => {
    if (!auth.checkPassword(req.body?.password)) {
      res.status(401).json({ error: 'Incorrect password' });
      return;
    }
    res.setHeader('Set-Cookie', serializeSessionCookie(auth.createSessionToken()));
    res.status(200).json({ ok: true });
  });
  app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    if (auth.verifySessionToken(cookies[SESSION_COOKIE_NAME])) { next(); return; }
    if (req.path.startsWith('/api/')) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.status(401).type('html').send(LOGIN_PAGE_HTML);
  });
  app.get('/api/workspaces/default', (_req, res) => res.json(workspaces.get('local')));
  app.get('/api/folders', async (req, res) => {
    try { res.json(await workspaces.browse(req.query.path)); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.post('/api/workspaces', async (req, res) => {
    try { res.json(await workspaces.open(req.body?.path, req.body?.create === true)); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  const frontendDist = path.resolve(fileURLToPath(import.meta.url), '../../../frontend/dist');
  app.use(express.static(frontendDist));
  // Terminal error handler: must be registered last, after all routes and
  // static serving, and must take 4 args for Express to treat it as an
  // error handler. Never leak err.stack or other error detail to clients.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled Express error:', err);
    // If headers are already sent, delegate to Express's default handler,
    // which safely destroys the connection — returning here would leave
    // the response hanging open until the keep-alive timeout.
    if (res.headersSent) { next(err); return; }
    res.status(500).json({ error: 'Internal server error' });
  });
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer });
  const managers = new Set<PtyManager>();
  const roots = new Map<WebSocket, string>();
  const watches = new Set<() => void>();
  function broadcast(msg: ServerMessage, directory: string): void {
    for (const client of wss.clients) {
      if (roots.get(client) === directory && client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
    }
  }
  wss.on('connection', (ws, request) => {
    try {
      const cookies = parseCookies(request.headers.cookie);
      if (!auth.verifySessionToken(cookies[SESSION_COOKIE_NAME])) { ws.close(1008, 'Unauthorized'); return; }
      const origin = request.headers.origin;
      if (origin && origin !== `http://${request.headers.host}`) { ws.close(1008, 'Origin not allowed'); return; }
      const id = new URL(request.url ?? '/', 'http://localhost').searchParams.get('workspace') ?? 'local';
      const workspace = workspaces.get(id);
      if (!workspace) { ws.close(1008, 'Unknown workspace'); return; }
      const workspaceFs = new WorkspaceFs(workspace.path);
      roots.set(ws, workspace.path);
      const unwatch = workspaceFs.watch(event => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'fs:watch-event', ...event }));
      });
      watches.add(unwatch);
      const ptyManager = new PtyManager(workspace.path);
      managers.add(ptyManager);
      ws.on('close', () => { unwatch(); watches.delete(unwatch); roots.delete(ws); ptyManager.dispose(); managers.delete(ptyManager); });
      ws.on('message', async (raw) => {
        try {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            return;
          }
          if (!isClientMessage(parsed)) return;

          switch (parsed.type) {
            case 'pty:kill': ptyManager.kill(parsed.sessionId); break;
            case 'fs:create': case 'fs:rename': case 'fs:delete': {
              try {
                if (parsed.type === 'fs:create') await workspaceFs.create(parsed.path, parsed.directory);
                if (parsed.type === 'fs:rename') await workspaceFs.rename(parsed.path, parsed.destination);
                if (parsed.type === 'fs:delete') await workspaceFs.delete(parsed.path);
                broadcast({ type: 'fs:updated', path: parsed.path, operation: parsed.type.slice(3) as 'create' | 'rename' | 'delete', ...(parsed.type === 'fs:rename' ? { destination: parsed.destination } : {}) }, workspace.path);
              } catch (err) { ws.send(JSON.stringify({ type: 'fs:error', path: parsed.path, message: (err as Error).message })); }
              break;
            }
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
                ws.send(JSON.stringify({ type: 'fs:saved', path: parsed.path, content: parsed.content }));
              } catch (err) {
                ws.send(JSON.stringify({ type: 'fs:error', path: parsed.path, message: (err as Error).message }));
              }
              break;
            }
            case 'pty:create': {
              try { ptyManager.create(
                parsed.sessionId,
                parsed.cols,
                parsed.rows,
                (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pty:data', sessionId: parsed.sessionId, data })); },
                (exitCode) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pty:exit', sessionId: parsed.sessionId, exitCode })); },
              ); } catch {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pty:exit', sessionId: parsed.sessionId, exitCode: 1 }));
              }
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
        } catch (err) {
          console.error('WebSocket message handler error:', err);
          try { ws.close(1011, 'Internal error'); } catch { /* socket may already be closed */ }
        }
      });
    } catch (err) {
      console.error('WebSocket connection handler error:', err);
      try { ws.close(1011, 'Internal error'); } catch { /* socket may already be closed */ }
      return;
    }
  });

  return {
    httpServer,
    close: () => {
      for (const unwatch of watches) unwatch();
      for (const manager of managers) manager.dispose();
      for (const client of wss.clients) client.terminate();
      wss.close();
      httpServer.close();
    },
  };
}
