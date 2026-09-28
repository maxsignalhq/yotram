import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
async function setup(prepare?: (root: string) => Promise<void> | void) {
  const root = await folder(); const state = await folder();
  if (prepare) await prepare(root);
  const server = createServer(root, { password: 'test', stateDir: state });
  await new Promise<void>(resolve => server.httpServer.listen(0, '127.0.0.1', resolve)); cleanups.push(server.close);
  const port = (server.httpServer.address() as AddressInfo).port;
  const cookie = `${SESSION_COOKIE_NAME}=${new Auth('test').createSessionToken()}`;
  async function api(route: string, method = 'GET', body?: unknown) { return fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  const workspace = await (await api('/api/workspaces/default')).json() as { id: string };
  async function connect() { const ws = new WebSocket(`ws://127.0.0.1:${port}/?workspace=${workspace.id}`, { headers: { Cookie: cookie } }); await new Promise<void>(resolve => ws.once('open', resolve)); cleanups.push(() => ws.terminate()); return ws; }
  return { root, state, server, port, cookie, api, workspace, connect };
}
async function gitInit(root: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
  await writeFile(path.join(root, 'app.txt'), 'base');
  git('add', '.'); git('commit', '-qm', 'initial');
}
async function stubAgents(names: string[] = ['claude', 'codex']) {
  const bin = await folder();
  for (const name of names) {
    const filePath = path.join(bin, name);
    await writeFile(filePath, '#!/bin/sh\nprintf \'ARGS:%s\\n\' "$*"\n');
    await chmod(filePath, 0o755);
  }
  const gitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const gitDir = await folder();
  execFileSync('cp', [gitPath, path.join(gitDir, 'git')]);
  const originalPath = process.env.PATH; const originalShell = process.env.SHELL;
  process.env.PATH = `${bin}${path.delimiter}${gitDir}`;
  process.env.SHELL = '/bin/sh';
  cleanups.push(() => { process.env.PATH = originalPath; process.env.SHELL = originalShell; });
}
async function addOriginRemote(root: string): Promise<string> {
  const bare = await folder();
  execFileSync('git', ['init', '--bare', '-q', bare]);
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: root });
  return bare;
}
async function stubGh(prUrl: string, state: 'OPEN' | 'MERGED' | 'CLOSED', checks: 'none' | 'passing' | 'failing' | 'pending') {
  const bin = await folder();
  const rollup = checks === 'none' ? '[]' : checks === 'passing' ? '[{"conclusion":"SUCCESS"}]' : checks === 'failing' ? '[{"conclusion":"FAILURE"}]' : '[{"conclusion":null}]';
  const script = `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  echo "${prUrl}"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo '{"state":"${state}","statusCheckRollup":${rollup}}'
  exit 0
fi
exit 1
`;
  const filePath = path.join(bin, 'gh');
  await writeFile(filePath, script);
  await chmod(filePath, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  cleanups.push(() => { process.env.PATH = originalPath; });
}
async function waitFor<T>(fn: () => Promise<T | undefined>, timeout = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) { const value = await fn(); if (value !== undefined) return value; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('Timed out waiting for condition');
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

describe('agent races', () => {
  it('creates tagged experiments and running sessions for each racing agent, from one shared checkpoint', async () => {
    const { api, workspace } = await setup(gitInit);
    await stubAgents();
    const response = await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt: 'Refactor the login form', agents: ['claude', 'codex'] });
    expect(response.status).toBe(200);
    const { raceId } = await response.json();
    expect(raceId).toBeTruthy();
    const activity = await (await api(`/api/workspaces/${workspace.id}/activity`)).json();
    const members = activity.experiments.filter((e: any) => e.raceId === raceId);
    expect(members).toHaveLength(2);
    expect(members.map((m: any) => m.agent).sort()).toEqual(['claude', 'codex']);
    expect(activity.checkpoints).toHaveLength(1);
    for (const member of members) {
      expect(member.base).toBe(activity.checkpoints[0].ref);
      const workspaceList = await (await api('/api/workspaces')).json();
      const memberWorkspace = workspaceList.find((item: any) => item.path.endsWith(member.path) || item.path === member.path);
      const output = await waitFor(async () => {
        const result = await (await api(`/api/workspaces/${memberWorkspace.id}/output/${member.sessionId}`)).json();
        return result.output.includes('ARGS:') ? result : undefined;
      });
      expect(output.output).toContain('ARGS:Refactor the login form');
    }
  });
  it('treats the prompt as literal shell-quoted text, not executable shell syntax', async () => {
    const { api, workspace } = await setup(gitInit);
    await stubAgents(['claude']);
    const prompt = "it's a task: $(echo INJECTED) `echo ALSO_INJECTED`";
    const response = await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt, agents: ['claude'] });
    expect(response.status).toBe(200);
    const { raceId } = await response.json();
    const activity = await (await api(`/api/workspaces/${workspace.id}/activity`)).json();
    const member = activity.experiments.find((e: any) => e.raceId === raceId);
    const workspaceList = await (await api('/api/workspaces')).json();
    const memberWorkspace = workspaceList.find((item: any) => item.path.endsWith(member.path) || item.path === member.path);
    const output = await waitFor(async () => {
      const result = await (await api(`/api/workspaces/${memberWorkspace.id}/output/${member.sessionId}`)).json();
      return result.output.includes('ARGS:') ? result : undefined;
    });
    expect(output.output).toContain('$(echo INJECTED)');
    expect(output.output).toContain('`echo ALSO_INJECTED`');
  });
  it('strips C0 control characters (e.g. Ctrl-C) from the prompt so the typed command cannot be aborted mid-line and its remainder run directly', async () => {
    const { api, workspace } = await setup(gitInit);
    await stubAgents(['claude']);
    // \u0003 is ETX (Ctrl-C). If it reached the pty unsanitized, the terminal driver would
    // abort the partially-typed `claude '...` line and let the remainder run as a fresh,
    // unquoted shell command — orphaning the tracked-command completion marker.
    const prompt = 'hello\u0003touch /tmp/should-not-run marker';
    const response = await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt, agents: ['claude'] });
    expect(response.status).toBe(200);
    const { raceId } = await response.json();
    const activity = await (await api(`/api/workspaces/${workspace.id}/activity`)).json();
    const member = activity.experiments.find((e: any) => e.raceId === raceId);
    expect(member).toBeTruthy();
    expect(member.name).not.toContain('\u0003');
    const workspaceList = await (await api('/api/workspaces')).json();
    const memberWorkspace = workspaceList.find((item: any) => item.path.endsWith(member.path) || item.path === member.path);
    // If the command line had been aborted, the tracked-command completion marker would never
    // fire and this would time out instead of resolving.
    const output = await waitFor(async () => {
      const result = await (await api(`/api/workspaces/${memberWorkspace.id}/output/${member.sessionId}`)).json();
      return result.output.includes('ARGS:') ? result : undefined;
    });
    // The control character is neutralized (replaced with a space) and the whole prompt,
    // including the "touch ..." text, is passed as literal, quoted argument text to the
    // agent — never executed as a separate shell command.
    expect(output.output).toContain('ARGS:hello touch /tmp/should-not-run marker');
    const completed = await waitFor(async () => {
      const result = await (await api(`/api/workspaces/${memberWorkspace.id}/output/${member.sessionId}`)).json();
      return result.output.includes('yotram;complete') || !result.running ? result : undefined;
    });
    expect(completed).toBeTruthy();
  });
  it('preserves multi-line prompts (containing \\n) when sanitizing control characters', async () => {
    const { api, workspace } = await setup(gitInit);
    await stubAgents(['claude']);
    const prompt = 'first line\nsecond line';
    const response = await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt, agents: ['claude'] });
    expect(response.status).toBe(200);
    const { raceId } = await response.json();
    const activity = await (await api(`/api/workspaces/${workspace.id}/activity`)).json();
    const member = activity.experiments.find((e: any) => e.raceId === raceId);
    const workspaceList = await (await api('/api/workspaces')).json();
    const memberWorkspace = workspaceList.find((item: any) => item.path.endsWith(member.path) || item.path === member.path);
    const output = await waitFor(async () => {
      const result = await (await api(`/api/workspaces/${memberWorkspace.id}/output/${member.sessionId}`)).json();
      return result.output.includes('ARGS:') ? result : undefined;
    });
    expect(output.output).toContain('ARGS:first line');
    expect(output.output).toContain('second line');
  });
  it('rejects invalid race requests', async () => {
    const { api, workspace } = await setup(gitInit);
    await stubAgents(['claude']);
    expect((await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt: '', agents: ['claude'] })).status).toBe(400);
    expect((await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt: 'Task', agents: [] })).status).toBe(400);
    expect((await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt: 'Task', agents: ['claude', 'claude'] })).status).toBe(400);
    expect((await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt: 'Task', agents: ['claude', 'codex', 'claude', 'codex', 'claude'] })).status).toBe(400);
    expect((await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt: 'Task', agents: ['codex'] })).status).toBe(400);
    expect((await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt: 'Task', agents: ['gemini'] })).status).toBe(400);
  });
  it('reuses a supplied checkpoint instead of auto-creating one', async () => {
    const { api, workspace } = await setup(gitInit);
    await stubAgents(['claude']);
    const checkpoint = await (await api(`/api/workspaces/${workspace.id}/checkpoints`, 'POST', { label: 'Before race' })).json();
    const response = await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt: 'Task', agents: ['claude'], checkpointId: checkpoint.id });
    expect(response.status).toBe(200);
    const activity = await (await api(`/api/workspaces/${workspace.id}/activity`)).json();
    expect(activity.checkpoints).toHaveLength(1);
    expect(activity.checkpoints[0].id).toBe(checkpoint.id);
  });
  it('marks exactly one race member as the winner, server-side, and can clear it', async () => {
    const { api, workspace } = await setup(gitInit);
    await stubAgents();
    const raceResponse = await api(`/api/workspaces/${workspace.id}/races`, 'POST', { prompt: 'Add a footer', agents: ['claude', 'codex'] });
    const { raceId } = await raceResponse.json();
    const activity = await (await api(`/api/workspaces/${workspace.id}/activity`)).json();
    const members = activity.experiments.filter((e: any) => e.raceId === raceId);
    expect(members).toHaveLength(2);
    const [first, second] = members;

    const setWinner = await api(`/api/workspaces/${workspace.id}/experiments/${first.id}/winner`, 'PATCH', { winner: true });
    expect(setWinner.status).toBe(200);

    const afterSet = await (await api(`/api/workspaces/${workspace.id}/activity`)).json();
    const afterMembers = afterSet.experiments.filter((e: any) => e.raceId === raceId);
    expect(afterMembers.find((m: any) => m.id === first.id).winner).toBe(true);
    expect(afterMembers.find((m: any) => m.id === second.id).winner).toBe(false);

    const clearWinner = await api(`/api/workspaces/${workspace.id}/experiments/${first.id}/winner`, 'PATCH', { winner: false });
    expect(clearWinner.status).toBe(200);
    const afterClear = await (await api(`/api/workspaces/${workspace.id}/activity`)).json();
    const afterClearMembers = afterClear.experiments.filter((e: any) => e.raceId === raceId);
    expect(afterClearMembers.every((m: any) => m.winner !== true)).toBe(true);
  });
  it('rejects marking a winner on a standalone (non-raced) experiment', async () => {
    const { api, workspace } = await setup(gitInit);
    const created = await api(`/api/workspaces/${workspace.id}/experiments`, 'POST', { name: 'Solo experiment' });
    const experiment = await created.json();
    const response = await api(`/api/workspaces/${workspace.id}/experiments/${experiment.id}/winner`, 'PATCH', { winner: true });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/race members/i);
  });
});

describe('GitHub PR integration', () => {
  it('creates a pull request and stores its url/state/checks on the experiment', async () => {
    const { api, workspace, root } = await setup(gitInit);
    await addOriginRemote(root);
    const created = await api(`/api/workspaces/${workspace.id}/experiments`, 'POST', { name: 'Try a fix' });
    const experiment = await created.json();
    await stubGh('https://github.com/test/repo/pull/1', 'OPEN', 'none');
    const response = await api(`/api/workspaces/${workspace.id}/experiments/${experiment.id}/pr`, 'POST', {});
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.prUrl).toBe('https://github.com/test/repo/pull/1');
    expect(body.prState).toBe('open');
    expect(body.prChecks).toBe('none');
    const activity = await (await api(`/api/workspaces/${workspace.id}/activity`)).json();
    const stored = activity.experiments.find((e: any) => e.id === experiment.id);
    expect(stored.prUrl).toBe('https://github.com/test/repo/pull/1');
  });

  it('rejects creating a pull request when the experiment has uncommitted changes', async () => {
    const { api, workspace, root } = await setup(gitInit);
    await addOriginRemote(root);
    const created = await api(`/api/workspaces/${workspace.id}/experiments`, 'POST', { name: 'Try a fix' });
    const experiment = await created.json();
    await writeFile(path.join(experiment.path, 'app.txt'), 'uncommitted change');
    await stubGh('https://github.com/test/repo/pull/1', 'OPEN', 'none');
    const response = await api(`/api/workspaces/${workspace.id}/experiments/${experiment.id}/pr`, 'POST', {});
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/commit.*changes/i);
  });

  it('rejects creating a second pull request for the same experiment', async () => {
    const { api, workspace, root } = await setup(gitInit);
    await addOriginRemote(root);
    const created = await api(`/api/workspaces/${workspace.id}/experiments`, 'POST', { name: 'Try a fix' });
    const experiment = await created.json();
    await stubGh('https://github.com/test/repo/pull/1', 'OPEN', 'none');
    await api(`/api/workspaces/${workspace.id}/experiments/${experiment.id}/pr`, 'POST', {});
    const second = await api(`/api/workspaces/${workspace.id}/experiments/${experiment.id}/pr`, 'POST', {});
    expect(second.status).toBe(400);
    const body = await second.json();
    expect(body.error).toMatch(/already exists/i);
  });

  it('rejects creating a pull request when gh is not available', async () => {
    const { api, workspace, root } = await setup(gitInit);
    await addOriginRemote(root);
    const created = await api(`/api/workspaces/${workspace.id}/experiments`, 'POST', { name: 'Try a fix' });
    const experiment = await created.json();
    const gitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const gitDir = await folder();
    execFileSync('cp', [gitPath, path.join(gitDir, 'git')]);
    const originalPath = process.env.PATH;
    process.env.PATH = gitDir;
    cleanups.push(() => { process.env.PATH = originalPath; });
    const response = await api(`/api/workspaces/${workspace.id}/experiments/${experiment.id}/pr`, 'POST', {});
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/gh.*not available/i);
  });

  it('rejects refreshing a pull request that was never created', async () => {
    const { api, workspace } = await setup(gitInit);
    const created = await api(`/api/workspaces/${workspace.id}/experiments`, 'POST', { name: 'Try a fix' });
    const experiment = await created.json();
    const response = await api(`/api/workspaces/${workspace.id}/experiments/${experiment.id}/pr`);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/no pull request/i);
  });

  it('refreshes an existing pull request\'s state and checks', async () => {
    const { api, workspace, root } = await setup(gitInit);
    await addOriginRemote(root);
    const created = await api(`/api/workspaces/${workspace.id}/experiments`, 'POST', { name: 'Try a fix' });
    const experiment = await created.json();
    await stubGh('https://github.com/test/repo/pull/1', 'OPEN', 'pending');
    await api(`/api/workspaces/${workspace.id}/experiments/${experiment.id}/pr`, 'POST', {});
    await stubGh('https://github.com/test/repo/pull/1', 'MERGED', 'passing');
    const response = await api(`/api/workspaces/${workspace.id}/experiments/${experiment.id}/pr`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.prState).toBe('merged');
    expect(body.prChecks).toBe('passing');
  });

  it('reports gh availability on /api/agents', async () => {
    const { api } = await setup();
    const gitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const gitDir = await folder();
    execFileSync('cp', [gitPath, path.join(gitDir, 'git')]);
    const originalPath = process.env.PATH;
    process.env.PATH = gitDir;
    cleanups.push(() => { process.env.PATH = originalPath; });
    const before = await (await api('/api/agents')).json();
    expect(before.gh).toBe(false);
    const bin = await folder();
    await writeFile(path.join(bin, 'gh'), '#!/bin/sh\nexit 0\n');
    await chmod(path.join(bin, 'gh'), 0o755);
    process.env.PATH = `${bin}${path.delimiter}${gitDir}`;
    const after = await (await api('/api/agents')).json();
    expect(after.gh).toBe(true);
  });

  it('persists view state through a server restart', async () => {
    const root = await folder(); const state = await folder();
    const first = createServer(root, { password: 'test', stateDir: state });
    await new Promise<void>(resolve => first.httpServer.listen(0, '127.0.0.1', resolve));
    const firstPort = (first.httpServer.address() as AddressInfo).port;
    const cookie = `${SESSION_COOKIE_NAME}=${new Auth('test').createSessionToken()}`;
    const workspace = await (await fetch(`http://127.0.0.1:${firstPort}/api/workspaces/default`, { headers: { Cookie: cookie } })).json() as { id: string };
    const ws = new WebSocket(`ws://127.0.0.1:${firstPort}/?workspace=${workspace.id}`, { headers: { Cookie: cookie } });
    await new Promise<void>(resolve => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'view:update', patch: { sidebarTab: 'git', terminalVisible: true } }));
    await new Promise(resolve => setTimeout(resolve, 50));
    ws.terminate();
    first.close();
    const second = createServer(root, { password: 'test', stateDir: state }); cleanups.push(second.close);
    await new Promise<void>(resolve => second.httpServer.listen(0, '127.0.0.1', resolve));
    const secondPort = (second.httpServer.address() as AddressInfo).port;
    const activity = await (await fetch(`http://127.0.0.1:${secondPort}/api/workspaces/${workspace.id}/activity`, { headers: { Cookie: cookie } })).json();
    expect(activity.viewState).toEqual(expect.objectContaining({ sidebarTab: 'git', terminalVisible: true }));
  });
});
