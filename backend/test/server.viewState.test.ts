import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { Auth, SESSION_COOKIE_NAME } from '../src/auth.js';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function folder() { const root = await mkdtemp(path.join(tmpdir(), 'yotram-viewstate-')); cleanups.push(() => rm(root, { recursive: true, force: true })); return root; }

async function setup() {
  const root = await folder(); const state = await folder();
  const server = createServer(root, { password: 'test', stateDir: state });
  await new Promise<void>(resolve => server.httpServer.listen(0, '127.0.0.1', resolve)); cleanups.push(server.close);
  const port = (server.httpServer.address() as AddressInfo).port;
  const cookie = `${SESSION_COOKIE_NAME}=${new Auth('test').createSessionToken()}`;
  async function api(route: string) { return fetch(`http://127.0.0.1:${port}${route}`, { headers: { Cookie: cookie } }); }
  const workspace = await (await api('/api/workspaces/default')).json() as { id: string };
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?workspace=${workspace.id}`, { headers: { Cookie: cookie } });
    await new Promise<void>(resolve => ws.once('open', resolve));
    cleanups.push(() => ws.terminate());
    return ws;
  }
  return { workspace, connect };
}
function message(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', listener); reject(new Error(`Timed out waiting for ${type}`)); }, 4000);
    const listener = (data: WebSocket.RawData) => { const result = JSON.parse(data.toString()); if (result.type === type) { clearTimeout(timer); ws.off('message', listener); resolve(result); } };
    ws.on('message', listener);
  });
}

describe('view state', () => {
  it('returns empty defaults before anything has been saved', async () => {
    const { connect } = await setup();
    const ws = await connect();
    const reply = message(ws, 'view:state');
    ws.send(JSON.stringify({ type: 'view:get' }));
    const result = await reply;
    expect(result.state).toEqual({ openFiles: [], activeFile: null, editorState: {}, sidebarTab: 'files', terminalVisible: false, activeTerminal: null, preview: false });
  });

  it('merges a partial update and returns it on the next get', async () => {
    const { connect } = await setup();
    const ws = await connect();
    ws.send(JSON.stringify({ type: 'view:update', patch: { openFiles: ['a.ts'], activeFile: 'a.ts' } }));
    await new Promise(resolve => setTimeout(resolve, 50));
    const reply = message(ws, 'view:state');
    ws.send(JSON.stringify({ type: 'view:get' }));
    const result = await reply;
    expect(result.state.openFiles).toEqual(['a.ts']);
    expect(result.state.activeFile).toBe('a.ts');
  });

  it('shallow-merges a second patch, keeping keys the second patch did not touch', async () => {
    const { connect } = await setup();
    const ws = await connect();
    ws.send(JSON.stringify({ type: 'view:update', patch: { openFiles: ['a.ts'], activeFile: 'a.ts' } }));
    await new Promise(resolve => setTimeout(resolve, 50));
    ws.send(JSON.stringify({ type: 'view:update', patch: { sidebarTab: 'git' } }));
    await new Promise(resolve => setTimeout(resolve, 50));
    const reply = message(ws, 'view:state');
    ws.send(JSON.stringify({ type: 'view:get' }));
    const result = await reply;
    expect(result.state.openFiles).toEqual(['a.ts']);
    expect(result.state.activeFile).toBe('a.ts');
    expect(result.state.sidebarTab).toBe('git');
  });

  it('rejects an invalid sidebarTab value and leaves state unchanged', async () => {
    const { connect } = await setup();
    const ws = await connect();
    ws.send(JSON.stringify({ type: 'view:update', patch: { sidebarTab: 'bogus' } }));
    await new Promise(resolve => setTimeout(resolve, 50));
    const reply = message(ws, 'view:state');
    ws.send(JSON.stringify({ type: 'view:get' }));
    const result = await reply;
    expect(result.state.sidebarTab).toBe('files');
  });
});
