import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { Workspaces } from './workspaces.js';
import { Runtime } from './runtime.js';
import { ActivityStore } from './activity.js';
import { Experiments } from './experiments.js';
import { PreviewService } from './preview.js';
import { workflowRoutes } from './workflowRoutes.js';
import os from 'node:os';
import { Git } from './git.js';
import { listSessions } from './sessions.js';
import { isClientMessage, ServerMessage, ViewState } from './protocol.js';
import { Auth, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from './auth.js';
import { PluginHost } from './plugins.js';
import { NotebookPlugin } from './notebooks.js';
import { dataViewerManifest, dataViewerRoutes } from './dataViewer.js';
import { sqlExplorerManifest, sqlExplorerRoutes } from './sqlExplorer.js';
import { gitHistoryManifest, gitHistoryRoutes } from './gitHistory.js';

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

function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

const LOGIN_PAGE_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Yotram — Sign in</title>
  <style>
    :root {
      --bg: #ffffff; --bg-panel: #f3f3f3; --border: #d4d4d4; --text: #1e1e1e;
      --text-muted: #6e6e6e; --accent: #005fb8; --accent-fg: #ffffff;
      --danger-text: #7a1f1a;
      color-scheme: light dark;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1e1e1e; --bg-panel: #252526; --border: #3c3c3c; --text: #cccccc;
        --text-muted: #8a8a8a; --accent: #3794ff; --accent-fg: #ffffff;
        --danger-text: #f48771;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: var(--bg); color: var(--text);
      font-family: -apple-system, 'Segoe UI', system-ui, Roboto, sans-serif;
    }
    main { width: min(320px, 90vw); padding: 28px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px; }
    p.eyebrow { margin: 0 0 4px; color: var(--accent); font-size: 11px; letter-spacing: .14em; }
    h1 { margin: 0 0 20px; font-size: 20px; }
    label { display: block; margin-bottom: 6px; font-size: 12px; color: var(--text-muted); }
    input {
      width: 100%; background: var(--bg); color: var(--text); border: 1px solid var(--border);
      padding: 10px; border-radius: 5px; font: inherit; margin-bottom: 12px;
    }
    button {
      width: 100%; padding: 10px; border: none; border-radius: 5px;
      background: var(--accent); color: var(--accent-fg); font-size: 14px; cursor: pointer;
    }
    button:hover { filter: brightness(1.08); }
    #error { min-height: 16px; margin: 10px 0 0; color: var(--danger-text); font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">YOTRAM</p>
    <h1>Sign in</h1>
    <form id="login">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" placeholder="Password" autofocus required />
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

export function createServer(rootDir: string, options: { password: string; stateDir?: string }): { httpServer: http.Server; close: () => void } {
  const app = express();
  const workspaces = new Workspaces(rootDir);
  const auth = new Auth(options.password);
  const store = new ActivityStore(options.stateDir);
  const plugins = new PluginHost(options.stateDir ?? path.join(os.homedir(), '.yotram', 'state'));
  const notebooks = new NotebookPlugin();
  plugins.register(notebooks);
  plugins.register({ manifest: dataViewerManifest, deactivate() {}, dispose() {} });
  plugins.register({ manifest: sqlExplorerManifest, deactivate() {}, dispose() {} });
  plugins.register({ manifest: gitHistoryManifest, deactivate() {}, dispose() {} });
  workspaces.restore(store.all().filter(record => !record.forgotten));
  store.register(workspaces.get('local')!);
  const runtimes = new Map<string, Runtime>();
  const runtime = (workspace: import('./workspaces.js').Workspace) => {
    let r = runtimes.get(workspace.id);
    if (!r) { r = new Runtime(workspace, store, message => broadcast(message, workspace.path)); runtimes.set(workspace.id, r); }
    return r;
  };
  const experiments = new Experiments(store, path.join(options.stateDir ?? path.join(os.tmpdir(), `yotram-${process.pid}`), 'experiments'));
  const previews = new PreviewService(() => {
    const address = httpServer.address(); return typeof address === 'object' && address ? address.port : 0;
  }, () => { const address = httpServer.address(); return typeof address === 'object' && address ? address.address : '127.0.0.1'; });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) { res.status(403).json({ error: 'Origin not allowed' }); return; }
    next();
  });
  app.use('/api/workspaces/:id/notebooks', express.json({ limit: '1mb' }));
  app.use('/api/workspaces/:id/sqlite/query', express.json({ limit: '300kb' }));
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
  app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.status(200).json({ ok: true });
  });
  app.get('/api/workspaces/default', (_req, res) => res.json(workspaces.get('local')));
  app.get('/api/folders', async (req, res) => {
    try { res.json(await workspaces.browse(req.query.path)); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.post('/api/workspaces', async (req, res) => {
    try { const workspace = await workspaces.open(req.body?.path, req.body?.create === true); store.register(workspace); runtime(workspace); res.json(workspace); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.get('/api/sessions', async (req, res) => {
    const { path: workspacePath } = req.query;
    if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
      res.status(400).json({ error: 'Query parameter "path" is required' });
      return;
    }
    try { res.json(await listSessions(workspacePath)); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  workflowRoutes(app, store, workspaces, runtime, experiments, previews);
  plugins.routes(app, workspaces);
  notebooks.routes(app, workspaces, plugins);
  dataViewerRoutes(app, workspaces, plugins);
  sqlExplorerRoutes(app, workspaces, plugins);
  gitHistoryRoutes(app, workspaces, plugins);
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
  const roots = new Map<WebSocket, string>();
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
      roots.set(ws, workspace.path);
      const r = runtime(workspace);
      const workspaceFs = r.fs;
      const ptyManager = r.pty;
      const git = new Git(workspace.path);
      ws.on('close', () => { roots.delete(ws); });
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
            case 'pty:kill': ptyManager.kill(parsed.sessionId); r.list(); break;
            case 'pty:list': ws.send(JSON.stringify({ type: 'pty:list', sessions: ptyManager.list() })); break;
            case 'pty:ack': ptyManager.acknowledge(parsed.sessionId); r.list(); break;
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
              try {
                r.create(parsed.sessionId, parsed.cols, parsed.rows, parsed.command);
                ws.send(JSON.stringify({ type: 'pty:ready', sessionId: parsed.sessionId, output: ptyManager.replay(parsed.sessionId), exitCode: ptyManager.list().find(s => s.id === parsed.sessionId)?.exitCode }));
              } catch (error) {
                ws.send(JSON.stringify({ type: 'pty:error', sessionId: parsed.sessionId, message: (error as Error).message }));
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
            case 'git:status': {
              try {
                const result = await git.status();
                ws.send(JSON.stringify({ type: 'git:status', ...result }));
              } catch (err) {
                ws.send(JSON.stringify({ type: 'git:error', message: (err as Error).message }));
              }
              break;
            }
            case 'git:diff': {
              try {
                const result = await git.diff(parsed.path, parsed.staged);
                ws.send(JSON.stringify({ type: 'git:diff', path: parsed.path, staged: parsed.staged, ...result }));
              } catch (err) {
                ws.send(JSON.stringify({ type: 'git:error', message: (err as Error).message }));
              }
              break;
            }
            case 'git:stage': case 'git:unstage': {
              try {
                if (parsed.type === 'git:stage') await git.stage(parsed.path); else await git.unstage(parsed.path);
                const result = await git.status();
                ws.send(JSON.stringify({ type: 'git:status', ...result }));
              } catch (err) {
                ws.send(JSON.stringify({ type: 'git:error', message: (err as Error).message }));
              }
              break;
            }
            case 'git:commit': {
              try {
                await git.commit(parsed.message);
                const result = await git.status();
                ws.send(JSON.stringify({ type: 'git:status', ...result }));
              } catch (err) {
                ws.send(JSON.stringify({ type: 'git:error', message: (err as Error).message }));
              }
              break;
            }
            case 'git:branches': {
              try {
                const branches = await git.branches();
                ws.send(JSON.stringify({ type: 'git:branches', branches }));
              } catch (err) {
                ws.send(JSON.stringify({ type: 'git:error', message: (err as Error).message }));
              }
              break;
            }
            case 'view:get': {
              const defaults: ViewState = { openFiles: [], activeFile: null, editorState: {}, sidebarTab: 'files', terminalVisible: false, activeTerminal: null, preview: false };
              const state: ViewState = { ...defaults, ...store.get(workspace.id)?.viewState };
              ws.send(JSON.stringify({ type: 'view:state', state }));
              break;
            }
            case 'view:update': {
              const record = store.register(workspace);
              const defaults: ViewState = { openFiles: [], activeFile: null, editorState: {}, sidebarTab: 'files', terminalVisible: false, activeTerminal: null, preview: false };
              record.viewState = { ...defaults, ...record.viewState, ...parsed.patch };
              store.changed();
              break;
            }
            case 'git:checkout': {
              try {
                await git.checkout(parsed.name);
                const [status, branches] = await Promise.all([git.status(), git.branches()]);
                ws.send(JSON.stringify({ type: 'git:status', ...status }));
                ws.send(JSON.stringify({ type: 'git:branches', branches }));
              } catch (err) {
                ws.send(JSON.stringify({ type: 'git:error', message: (err as Error).message }));
              }
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

  let closed = false;
  return {
    httpServer,
    close: () => {
      if (closed) return; closed = true;
      for (const r of runtimes.values()) r.dispose();
      previews.close();
      plugins.dispose();
      store.flush();
      for (const client of wss.clients) client.terminate();
      wss.close();
      httpServer.close();
    },
  };
}
