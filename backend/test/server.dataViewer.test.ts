import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.js';
import { Auth, SESSION_COOKIE_NAME } from '../src/auth.js';

const password = 'data-viewer-test-password';
let root: string;
let stateDir: string;
let base: string;
let cookie: string;
let close: () => void;
let workspaceId: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yotram-data-route-'));
  stateDir = path.join(root, 'state');
  await mkdir(path.join(root, 'project'));
  await writeFile(path.join(root, 'project', 'sample.parquet'), Buffer.from([0, 255, 10, 128]));
  const server = createServer(path.join(root, 'project'), { password, stateDir });
  close = server.close;
  await new Promise<void>(resolve => server.httpServer.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  cookie = `${SESSION_COOKIE_NAME}=${new Auth(password).createSessionToken()}`;
  const workspaces = await (await fetch(`${base}/api/workspaces`, { headers: { Cookie: cookie } })).json() as { id: string }[];
  workspaceId = workspaces[0].id;
});

afterAll(async () => { close(); await rm(root, { recursive: true, force: true }); });

describe('Data Viewer binary route', () => {
  it('requires authentication and an enabled plugin, then returns exact bytes from its workspace', async () => {
    const url = `${base}/api/workspaces/${workspaceId}/data/binary?path=sample.parquet`;
    expect((await fetch(url)).status).toBe(401);
    const disabled = await fetch(url, { headers: { Cookie: cookie } });
    expect(disabled.status).toBe(400);
    expect(await disabled.json()).toMatchObject({ error: expect.stringContaining('Enable the Data Viewer') });
    await fetch(`${base}/api/workspaces/${workspaceId}/plugins/yotram.data-viewer`, {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    const response = await fetch(url, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0, 255, 10, 128]));
  });

  it('rejects non-Parquet paths and paths outside the selected workspace', async () => {
    await fetch(`${base}/api/workspaces/${workspaceId}/plugins/yotram.data-viewer`, {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    const headers = { Cookie: cookie };
    expect((await fetch(`${base}/api/workspaces/${workspaceId}/data/binary?path=sample.csv`, { headers })).status).toBe(400);
    expect((await fetch(`${base}/api/workspaces/${workspaceId}/data/binary?path=../escape.parquet`, { headers })).status).toBe(400);
  });
});
