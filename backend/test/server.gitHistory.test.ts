import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.js';
import { Auth, SESSION_COOKIE_NAME } from '../src/auth.js';

const run = promisify(execFile);
const password = 'git-history-test-password';
let root: string;
let base: string;
let cookie: string;
let close: () => void;
let workspaceId: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yotram-git-history-'));
  await run('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await run('git', ['config', 'user.email', 'history@example.com'], { cwd: root });
  await run('git', ['config', 'user.name', 'History Tester'], { cwd: root });
  await writeFile(path.join(root, 'notes.md'), 'original\n');
  await run('git', ['add', '.'], { cwd: root });
  await run('git', ['commit', '-q', '-m', 'Add notes'], { cwd: root });
  await writeFile(path.join(root, 'notes.md'), 'updated\n');
  await run('git', ['add', '.'], { cwd: root });
  await run('git', ['commit', '-q', '-m', 'Update notes'], { cwd: root });
  const server = createServer(root, { password, stateDir: path.join(root, '.yotram-test-state') }); close = server.close;
  await new Promise<void>(resolve => server.httpServer.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  cookie = `${SESSION_COOKIE_NAME}=${new Auth(password).createSessionToken()}`;
  const workspaces = await (await fetch(`${base}/api/workspaces`, { headers: { Cookie: cookie } })).json() as { id: string }[];
  workspaceId = workspaces[0].id;
  await fetch(`${base}/api/workspaces/${workspaceId}/plugins/yotram.git-history`, {
    method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
  });
});

afterAll(async () => { close(); await rm(root, { recursive: true, force: true }); });

describe('Git History routes', () => {
  it('lists commits and changed files, then returns a workspace-contained diff', async () => {
    const url = `${base}/api/workspaces/${workspaceId}/git-history`;
    expect((await fetch(url)).status).toBe(401);
    const response = await fetch(`${url}?limit=10`, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    const commits = (await response.json() as { commits: { hash: string; subject: string }[] }).commits;
    expect(commits.map(commit => commit.subject)).toEqual(['Update notes', 'Add notes']);
    const filesResponse = await fetch(`${url}/${commits[0].hash}/files`, { headers: { Cookie: cookie } });
    expect(await filesResponse.json()).toEqual({ files: [{ status: 'M', path: 'notes.md' }] });
    const diffResponse = await fetch(`${url}/diff`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: commits[0].hash, path: 'notes.md' }),
    });
    expect(await diffResponse.json()).toEqual({ before: 'original\n', after: 'updated\n' });
  });

  it('enforces plugin enablement and rejects invalid commit ids and escaping paths', async () => {
    const url = `${base}/api/workspaces/${workspaceId}/git-history`;
    await fetch(`${base}/api/workspaces/${workspaceId}/plugins/yotram.git-history`, {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    });
    expect((await fetch(url, { headers: { Cookie: cookie } })).status).toBe(400);
    await fetch(`${base}/api/workspaces/${workspaceId}/plugins/yotram.git-history`, {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    const badHash = await fetch(`${url}/not-a-commit/files`, { headers: { Cookie: cookie } });
    expect(badHash.status).toBe(400);
    const badPath = await fetch(`${url}/diff`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: '0123456789abcdef0123456789abcdef01234567', path: '../outside' }),
    });
    expect(badPath.status).toBe(400);
  });
});
