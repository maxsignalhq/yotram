import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { execFileSync } from 'node:child_process';
import { createServer } from '../src/server.js';
import { Auth, SESSION_COOKIE_NAME } from '../src/auth.js';
import { ActivityStore } from '../src/activity.js';
import { Experiments } from '../src/experiments.js';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function folder() { const root = await mkdtemp(path.join(tmpdir(), 'yotram-workflow-')); cleanups.push(() => rm(root, { recursive: true, force: true })); return root; }
async function setup() {
  const root = await folder(); const state = await folder();
  const server = createServer(root, { password: 'test', stateDir: state });
  await new Promise<void>(resolve => server.httpServer.listen(0, '127.0.0.1', resolve)); cleanups.push(server.close);
  const port = (server.httpServer.address() as AddressInfo).port;
  const cookie = `${SESSION_COOKIE_NAME}=${new Auth('test').createSessionToken()}`;
  async function api(route: string, method = 'GET', body?: unknown) { return fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  const workspace = await (await api('/api/workspaces/default')).json() as { id: string };
  async function connect() { const ws = new WebSocket(`ws://127.0.0.1:${port}/?workspace=${workspace.id}`, { headers: { Cookie: cookie } }); await new Promise<void>(resolve => ws.once('open', resolve)); cleanups.push(() => ws.terminate()); return ws; }
  return { root, state, server, port, cookie, api, workspace, connect };
}
function message(ws: WebSocket, type: string): Promise<any> { return new Promise((resolve, reject) => { const timer = setTimeout(() => { ws.off('message', listener); reject(new Error(`Timed out waiting for ${type}`)); }, 4000); const listener = (data: WebSocket.RawData) => { const result = JSON.parse(data.toString()); if (result.type === type) { clearTimeout(timer); ws.off('message', listener); resolve(result); } }; ws.on('message', listener); }); }

describe('workspace workflows', () => {
  it('reattaches to the same shell from a second connection, replaying output without rerunning commands', async () => {
    const { connect, api, workspace } = await setup(); const ws = await connect();
    const ready = message(ws, 'pty:ready'); const completed = message(ws, 'pty:signal');
    ws.send(JSON.stringify({ type: 'pty:create', sessionId: 'persist', cols: 80, rows: 24, command: 'echo REPLAY_PROOF' }));
    await ready; expect((await completed).value).toBe('0');
    const before = await (await api(`/api/workspaces/${workspace.id}/resources`)).json() as any[];
    ws.close(); await new Promise<void>(resolve => ws.once('close', () => resolve()));
    const second = await connect(); const replay = message(second, 'pty:ready'); second.send(JSON.stringify({ type: 'pty:create', sessionId: 'persist', cols: 80, rows: 24, command: 'echo SHOULD_NOT_RUN' }));
    const restored = await replay; expect(restored.output).toContain('REPLAY_PROOF'); expect(restored.output).not.toContain('SHOULD_NOT_RUN');
    const after = await (await api(`/api/workspaces/${workspace.id}/resources`)).json() as any[]; expect(after[0].pid).toBe(before[0].pid);
    expect(after[0].processes.some((p: any) => p.pid === before[0].pid)).toBe(true);
    await api(`/api/workspaces/${workspace.id}/sessions/persist`, 'DELETE');
    const empty = await (await api(`/api/workspaces/${workspace.id}/resources`)).json(); expect(empty).toEqual([]);
  });
  it('persists handoffs, history and workspace registration, and clears retained output', async () => {
    const { api, workspace, state, server } = await setup();
    expect((await api(`/api/workspaces/${workspace.id}/handoffs`, 'POST', { note: 'Investigate layout', next: 'Check mobile', file: 'index.html' })).status).toBe(200);
    server.close();
    const store = new ActivityStore(state); const record = store.get(workspace.id)!;
    expect(record.handoffs[0].next).toBe('Check mobile'); expect(record.events.some(e => e.kind === 'handoff')).toBe(true);
    store.output(workspace.id, 's', 'api_key=secret-value'); store.flush(); expect(new ActivityStore(state).get(workspace.id)?.output.s).toContain('[redacted]');
    expect(await readFile(path.join(state, 'workspaces.json'), 'utf8')).not.toContain('secret-value');
  });
  it('serves previews on a separate authenticated origin, strips IDE credentials and retains root-relative URLs', async () => {
    const upstream = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<html><body><h1>Preview</h1><script src="/app.js"></script><p>${req.headers.cookie ?? 'no cookie'}</p></body></html>`); });
    const upstreamWs = new WebSocketServer({ server: upstream });
    upstreamWs.on('connection', (ws, request) => { ws.on('message', raw => ws.send(`${request.headers.cookie ?? 'no cookie'}:${raw}`)); });
    cleanups.push(() => { for (const ws of upstreamWs.clients) ws.terminate(); upstreamWs.close(); });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve)); cleanups.push(() => { upstream.closeAllConnections(); upstream.close(); });
    const { api, workspace, port } = await setup();
    const response = await api(`/api/workspaces/${workspace.id}/preview`, 'POST', { port: (upstream.address() as AddressInfo).port, inspect: true }); expect(response.status).toBe(200);
    const gateway = await response.json() as { port: number; ticket: string }; expect(gateway.port).not.toBe(port);
    const base = `http://127.0.0.1:${gateway.port}`;
    expect((await fetch(base)).status).toBe(401);
    const login = await fetch(`${base}/?__yotram_preview=${gateway.ticket}`, { redirect: 'manual' }); expect(login.status).toBe(302);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const page = await (await fetch(base, { headers: { Cookie: `${cookie}; yotram_session=SECRET`, Authorization: 'Bearer SECRET' } })).text();
    const socket = new WebSocket(`ws://127.0.0.1:${gateway.port}/live`, { headers: { Cookie: `${cookie}; yotram_session=SECRET`, Origin: base } });
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const echo = new Promise<string>(resolve => socket.once('message', raw => resolve(raw.toString()))); socket.send('HMR');
    expect(await echo).toBe('no cookie:HMR'); socket.terminate();
    expect(page).toContain('no cookie'); expect(page).not.toContain('SECRET'); expect(page).toContain('yotram:selection'); expect(page).toContain('src="/app.js"');
    expect((await fetch(`${base}/?__yotram_preview=${gateway.ticket}`, { redirect: 'manual' })).status).toBe(401);
    expect((await api(`/api/workspaces/${workspace.id}/preview`, 'POST', { port })).status).toBe(400);
  });
  it('snapshots dirty work without altering the index, compares untracked experiment changes and safely discards', async () => {
    const root = await folder(); const state = await folder();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
    await writeFile(path.join(root, 'app.txt'), 'original'); git('add', '.'); git('commit', '-qm', 'initial');
    await writeFile(path.join(root, 'app.txt'), 'working change'); await writeFile(path.join(root, '.env'), 'SECRET=value'); await writeFile(path.join(root, 'new.txt'), 'new file');
    const before = git('diff', '--cached');
    const store = new ActivityStore(state); store.register({ id: 'project', name: 'project', path: root }); const experiments = new Experiments(store, path.join(state, 'experiments'));
    await expect(experiments.create('project', 'unsafe')).rejects.toThrow('Uncommitted');
    const checkpoint = await experiments.checkpoint('project', 'Before alternative'); expect(git('diff', '--cached')).toBe(before); expect(checkpoint.patch).toContain('working change'); expect(checkpoint.patch).not.toContain('SECRET');
    const experiment = await experiments.create('project', 'Alternative', checkpoint.id);
    expect(await readFile(path.join(experiment.path, 'app.txt'), 'utf8')).toBe('working change');
    await writeFile(path.join(experiment.path, 'extra.txt'), 'experiment only'); expect(await experiments.compare('project', experiment.id)).toContain('experiment only');
    await expect(experiments.merge('project', experiment.id)).rejects.toThrow('Commit changes');
    await expect(experiments.discard('project', experiment.id, false)).rejects.toThrow('Confirm');
    await experiments.discard('project', experiment.id, true); store.flush(); expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('working change');
  });
});

it('merges a committed alternative and preserves unrelated original work', async () => {
  const root = await folder(); const state = await folder();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
  await writeFile(path.join(root, 'base.txt'), 'base'); git('add', '.'); git('commit', '-qm', 'initial');
  const store = new ActivityStore(state); store.register({ id: 'merge', name: 'merge', path: root }); const experiments = new Experiments(store, path.join(state, 'experiments'));
  const experiment = await experiments.create('merge', 'Merge me');
  await writeFile(path.join(experiment.path, 'alternative.txt'), 'alternative');
  execFileSync('git', ['add', '.'], { cwd: experiment.path }); execFileSync('git', ['commit', '-qm', 'alternative'], { cwd: experiment.path });
  await writeFile(path.join(root, 'original.txt'), 'original'); git('add', '.'); git('commit', '-qm', 'original');
  await experiments.merge('merge', experiment.id);
  expect(await readFile(path.join(root, 'original.txt'), 'utf8')).toBe('original');
  expect(await readFile(path.join(root, 'alternative.txt'), 'utf8')).toBe('alternative');
  await experiments.discard('merge', experiment.id, true); store.flush();
});

it('does not feed the completion marker into an interactive tracked program', async () => {
  const { connect } = await setup(); const ws = await connect();
  const ready = message(ws, 'pty:ready');
  ws.send(JSON.stringify({ type: 'pty:create', sessionId: 'interactive', cols: 80, rows: 24, command: 'read -r answer; echo RECEIVED:$answer' }));
  await ready;
  let finished = false; const done = message(ws, 'pty:signal').then(result => { finished = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 400)); expect(finished).toBe(false);
  ws.send(JSON.stringify({ type: 'pty:data', sessionId: 'interactive', data: 'USER_INPUT\r' }));
  expect((await done).value).toBe('0');
  const replay = message(ws, 'pty:ready'); ws.send(JSON.stringify({ type: 'pty:create', sessionId: 'interactive', cols: 80, rows: 24 }));
  expect((await replay).output).toContain('RECEIVED:USER_INPUT');
});
