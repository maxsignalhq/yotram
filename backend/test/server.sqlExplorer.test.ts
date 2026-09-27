import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.js';
import { Auth, SESSION_COOKIE_NAME } from '../src/auth.js';

const password = 'sql-explorer-test-password';
const require = createRequire(import.meta.url);
const sqlJsEntry = pathToFileURL(require.resolve('sql.js'));
let root: string;
let base: string;
let cookie: string;
let close: () => void;
let workspaceId: string;
let original: Buffer;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yotram-sql-route-'));
  const project = path.join(root, 'project'); const state = path.join(root, 'state');
  await mkdir(project);
  const SQL: SqlJsStatic = await initSqlJs({ locateFile: file => fileURLToPath(new URL(file, sqlJsEntry)) });
  const db = new SQL.Database();
  db.run('CREATE TABLE items (id INTEGER PRIMARY KEY, category TEXT, score REAL); INSERT INTO items VALUES (1, \'a\', 2), (2, \'b\', 4), (3, \'a\', 6);');
  original = Buffer.from(db.export()); db.close();
  await writeFile(path.join(project, 'sample.sqlite'), original);
  const server = createServer(project, { password, stateDir: state }); close = server.close;
  await new Promise<void>(resolve => server.httpServer.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  cookie = `${SESSION_COOKIE_NAME}=${new Auth(password).createSessionToken()}`;
  const workspaces = await (await fetch(`${base}/api/workspaces`, { headers: { Cookie: cookie } })).json() as { id: string }[];
  workspaceId = workspaces[0].id;
});

afterAll(async () => { close(); await rm(root, { recursive: true, force: true }); });

describe('SQL Explorer routes', () => {
  it('requires authentication and the enabled plugin, and lists SQLite tables', async () => {
    const url = `${base}/api/workspaces/${workspaceId}/sqlite/schema?path=sample.sqlite`;
    expect((await fetch(url)).status).toBe(401);
    const disabled = await fetch(url, { headers: { Cookie: cookie } });
    expect(disabled.status).toBe(400);
    await fetch(`${base}/api/workspaces/${workspaceId}/plugins/yotram.sql-explorer`, {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    const response = await fetch(url, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ tables: [{ name: 'items', type: 'table' }] });
  });

  it('runs one read-only query with bounded results and does not alter the source database', async () => {
    const url = `${base}/api/workspaces/${workspaceId}/sqlite/query`;
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ path: 'sample.sqlite', sql: 'SELECT category, AVG(score) AS average FROM items GROUP BY category ORDER BY category' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ columns: ['category', 'average'], rows: [{ category: 'a', average: 4 }, { category: 'b', average: 4 }], truncated: false });
    const update = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ path: 'sample.sqlite', sql: 'UPDATE items SET score = 0' }) });
    expect(update.status).toBe(400);
    const cteWrite = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ path: 'sample.sqlite', sql: 'WITH rows AS (SELECT 1) DELETE FROM items' }) });
    expect(cteWrite.status).toBe(400);
    const multiple = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ path: 'sample.sqlite', sql: 'SELECT 1; SELECT 2' }) });
    expect(multiple.status).toBe(400);
    expect(await readFile(path.join(root, 'project', 'sample.sqlite'))).toEqual(original);
  });

  it('rejects unsupported or escaping database paths', async () => {
    const url = `${base}/api/workspaces/${workspaceId}/sqlite/schema`;
    const headers = { Cookie: cookie };
    expect((await fetch(`${url}?path=notes.csv`, { headers })).status).toBe(400);
    expect((await fetch(`${url}?path=../outside.sqlite`, { headers })).status).toBe(400);
  });
});
