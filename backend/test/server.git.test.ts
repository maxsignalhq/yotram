import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { Auth, SESSION_COOKIE_NAME } from '../src/auth.js';
import type { AddressInfo } from 'node:net';

const run = promisify(execFile);
const PASSWORD = 'test-password';

let root: string;
let close: () => void;
let port: number;
let sessionCookie: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yotram-server-git-'));
  await run('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await run('git', ['config', 'user.name', 'Test'], { cwd: root });
  await writeFile(path.join(root, 'a.txt'), 'original');
  await run('git', ['add', '.'], { cwd: root });
  await run('git', ['commit', '-q', '-m', 'init'], { cwd: root });

  const server = createServer(root, { password: PASSWORD });
  close = server.close;
  await new Promise<void>((resolve) => { server.httpServer.listen(0, '127.0.0.1', () => resolve()); });
  port = (server.httpServer.address() as AddressInfo).port;
  sessionCookie = `${SESSION_COOKIE_NAME}=${new Auth(PASSWORD).createSessionToken()}`;
});

afterAll(async () => {
  close();
  await rm(root, { recursive: true, force: true });
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Cookie: sessionCookie } });
    ws.on('open', () => resolve(ws));
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise(resolve => ws.once('message', raw => resolve(JSON.parse(raw.toString()))));
}

describe('git WebSocket protocol', () => {
  it('responds to git:status with the repo state', async () => {
    const ws = await connect();
    const response = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'git:status' }));
    const msg = await response;
    expect(msg).toEqual({ type: 'git:status', isRepo: true, branch: 'main', staged: [], unstaged: [], untracked: [] });
    ws.close();
  });

  it('stages a file and receives an updated status', async () => {
    const ws = await connect();
    await writeFile(path.join(root, 'a.txt'), 'edited');
    const response = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'git:stage', path: 'a.txt' }));
    const msg = await response;
    expect(msg).toEqual({ type: 'git:status', isRepo: true, branch: 'main', staged: ['a.txt'], unstaged: [], untracked: [] });
    // Clean up for later tests in this file.
    ws.send(JSON.stringify({ type: 'git:unstage', path: 'a.txt' }));
    await nextMessage(ws);
    await writeFile(path.join(root, 'a.txt'), 'original');
    ws.close();
  });

  it('returns a diff for a file', async () => {
    const ws = await connect();
    await writeFile(path.join(root, 'a.txt'), 'edited for diff');
    const response = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'git:diff', path: 'a.txt', staged: false }));
    const msg = await response;
    expect(msg).toEqual({ type: 'git:diff', path: 'a.txt', staged: false, before: 'original', after: 'edited for diff' });
    await writeFile(path.join(root, 'a.txt'), 'original');
    ws.close();
  });

  it('reports a git:error for a commit with nothing staged', async () => {
    const ws = await connect();
    const response = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'git:commit', message: 'nothing to commit' }));
    const msg = await response;
    expect(msg.type).toBe('git:error');
    ws.close();
  });

  it('lists branches and checks out a new one', async () => {
    await run('git', ['branch', 'feature'], { cwd: root });
    const ws = await connect();
    const branchesResponse = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'git:branches' }));
    const branches = await branchesResponse;
    expect(branches.branches).toEqual(expect.arrayContaining([
      { name: 'main', current: true },
      { name: 'feature', current: false },
    ]));

    const checkoutResponses: any[] = [];
    ws.on('message', raw => checkoutResponses.push(JSON.parse(raw.toString())));
    ws.send(JSON.stringify({ type: 'git:checkout', name: 'feature' }));
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(checkoutResponses.some(m => m.type === 'git:status' && m.branch === 'feature')).toBe(true);
    expect(checkoutResponses.some(m => m.type === 'git:branches')).toBe(true);
    await run('git', ['checkout', 'main'], { cwd: root });
    ws.close();
  });
});
