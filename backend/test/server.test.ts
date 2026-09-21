import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import type { AddressInfo } from 'node:net';

let root: string;
let close: () => void;
let port: number;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yotram-server-'));
  await writeFile(path.join(root, 'a.txt'), 'alpha');
  const server = createServer(root);
  close = server.close;
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  port = (server.httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  close();
  await rm(root, { recursive: true, force: true });
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
  });
}

describe('server WebSocket protocol', () => {
  it('responds to fs:read with file content', async () => {
    const ws = await connect();
    const response = new Promise<any>((resolve) => {
      ws.on('message', (raw) => resolve(JSON.parse(raw.toString())));
    });
    ws.send(JSON.stringify({ type: 'fs:read', path: 'a.txt' }));
    const msg = await response;
    expect(msg).toEqual({ type: 'fs:read', path: 'a.txt', content: 'alpha' });
    ws.close();
  });
});

it('routes connections to their own local project and blocks foreign origins', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'second', create: true }),
  });
  const workspace = await response.json() as { id: string };
  expect(response.status).toBe(200);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?workspace=${workspace.id}`);
  await new Promise<void>(resolve => ws.on('open', resolve));
  const message = new Promise<any>(resolve => ws.once('message', raw => resolve(JSON.parse(raw.toString()))));
  ws.send(JSON.stringify({ type: 'fs:read', path: 'a.txt' }));
  expect((await message).type).toBe('fs:error');
  ws.close();
  const denied = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' }, body: JSON.stringify({ path: root }),
  });
  expect(denied.status).toBe(403);
});
