// backend/test/server.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { Auth, SESSION_COOKIE_NAME } from '../src/auth.js';
import type { AddressInfo } from 'node:net';

const PASSWORD = 'test-password';

let root: string;
let close: () => void;
let port: number;
let sessionCookie: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yotram-server-'));
  await writeFile(path.join(root, 'a.txt'), 'alpha');
  const server = createServer(root, { password: PASSWORD });
  close = server.close;
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ path: 'second', create: true }),
  });
  const workspace = await response.json() as { id: string };
  expect(response.status).toBe(200);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?workspace=${workspace.id}`, { headers: { Cookie: sessionCookie } });
  await new Promise<void>(resolve => ws.on('open', resolve));
  const message = new Promise<any>(resolve => ws.once('message', raw => resolve(JSON.parse(raw.toString()))));
  ws.send(JSON.stringify({ type: 'fs:read', path: 'a.txt' }));
  expect((await message).type).toBe('fs:error');
  ws.close();
  const denied = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000', Cookie: sessionCookie },
    body: JSON.stringify({ path: root }),
  });
  expect(denied.status).toBe(403);
});

describe('authentication', () => {
  it('rejects API requests without a valid session cookie', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/workspaces/default`);
    expect(response.status).toBe(401);
  });

  it('serves the login page for unauthenticated browser requests', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('Sign in');
  });

  it('rejects a wrong password and accepts the correct one', async () => {
    const wrong = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'nope' }),
    });
    expect(wrong.status).toBe(401);

    const right = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }),
    });
    expect(right.status).toBe(200);
    expect(right.headers.get('set-cookie')).toContain(SESSION_COOKIE_NAME);
  });

  it('rejects a WebSocket connection without a valid session cookie', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const closeCode = await new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    expect(closeCode).toBe(1008);
  });

  it('does not crash the server on a malformed Cookie header over WebSocket, and the server keeps working afterward', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Cookie: 'a=%' } });
    const outcome = await new Promise<{ event: 'close' | 'error'; code?: number }>((resolve) => {
      ws.on('close', (code) => resolve({ event: 'close', code }));
      ws.on('error', () => resolve({ event: 'error' }));
    });
    // The malformed cookie falls back to its raw value, fails auth, and is rejected cleanly (not a crash).
    if (outcome.event === 'close') expect(outcome.code).toBe(1008);

    // Prove the process survived: a normal, authenticated request still works.
    const response = await fetch(`http://127.0.0.1:${port}/api/workspaces/default`, { headers: { Cookie: sessionCookie } });
    expect(response.status).toBe(200);
  });

  it('does not leak a stack trace for a GET request with a malformed Cookie header', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/workspaces/default`, { headers: { Cookie: 'a=%' } });
    const body = await response.text();
    expect(response.status).toBe(401);
    expect(body).not.toContain('at ');
    expect(body).not.toContain('.ts:');
    expect(body).not.toContain(process.cwd());
  });

  it('routes a thrown Express error through the terminal error handler without leaking a stack trace', async () => {
    // Malformed JSON body makes express.json() throw a SyntaxError, which
    // reaches next(err) and should be caught by the terminal error handler.
    const response = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: 'Internal server error' });
    expect(body).not.toContain('at ');
    expect(body).not.toContain('.ts:');
    expect(body).not.toContain(process.cwd());
  });

  it('parses multiple cookies and honors a valid session cookie among others', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/workspaces/default`, {
      headers: { Cookie: `foo=bar; ${sessionCookie}; baz=qux` },
    });
    expect(response.status).toBe(200);
  });
});
