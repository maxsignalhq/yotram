import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { mangleClaudePath } from '../src/sessions.js';
import { Auth, SESSION_COOKIE_NAME } from '../src/auth.js';
import type { AddressInfo } from 'node:net';

const PASSWORD = 'test-password';

let root: string;
let fakeHome: string;
let close: () => void;
let port: number;
let sessionCookie: string;
let originalHome: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yotram-server-sessions-'));
  fakeHome = path.join(root, 'home');
  await mkdir(fakeHome, { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = fakeHome;

  const workspacePath = path.join(root, 'project');
  const claudeDir = path.join(fakeHome, '.claude', 'projects', mangleClaudePath(workspacePath));
  await mkdir(claudeDir, { recursive: true });
  await writeFile(path.join(claudeDir, 'abc.jsonl'), JSON.stringify({ type: 'ai-title', aiTitle: 'Fixed the bug' }));

  const server = createServer(root, { password: PASSWORD });
  close = server.close;
  await new Promise<void>((resolve) => { server.httpServer.listen(0, '127.0.0.1', () => resolve()); });
  port = (server.httpServer.address() as AddressInfo).port;
  sessionCookie = `${SESSION_COOKIE_NAME}=${new Auth(PASSWORD).createSessionToken()}`;
});

afterAll(async () => {
  close();
  process.env.HOME = originalHome;
  await rm(root, { recursive: true, force: true });
});

describe('GET /api/sessions', () => {
  it('returns sessions matching the given workspace path', async () => {
    const workspacePath = path.join(root, 'project');
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions?path=${encodeURIComponent(workspacePath)}`, {
      headers: { Cookie: sessionCookie },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([{ id: 'abc', agent: 'claude', title: 'Fixed the bug', updatedAt: expect.any(Number) }]);
  });

  it('rejects a request with no path query param', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions`, { headers: { Cookie: sessionCookie } });
    expect(response.status).toBe(400);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions?path=${encodeURIComponent(root)}`);
    expect(response.status).toBe(401);
  });
});
