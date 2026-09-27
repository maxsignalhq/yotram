import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.js';
import { Auth, SESSION_COOKIE_NAME } from '../src/auth.js';

const cleanups: (() => void | Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'yotram-notebook-test-'));
  const state = await mkdtemp(path.join(tmpdir(), 'yotram-notebook-state-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }), () => rm(state, { recursive: true, force: true }));
  const server = createServer(root, { password: 'test', stateDir: state });
  cleanups.push(server.close);
  await new Promise<void>((resolve, reject) => { server.httpServer.once('error', reject); server.httpServer.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  const cookie = `${SESSION_COOKIE_NAME}=${new Auth('test').createSessionToken()}`;
  async function api(route: string, method = 'POST', body?: unknown, extraHeaders = {}) {
    return fetch(base + '/api/workspaces/local/' + route, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function enable(python = 'python3', enabled = true) {
    const res = await api('plugins/yotram.notebook', 'PUT', { enabled, settings: { python } }); expect(res.status).toBe(200);
  }
  async function action(action: string, file = 'test.ipynb', code?: string) { return api(`notebooks/${action}`, 'POST', { path: file, code }); }
  async function execute(code: string, file = 'test.ipynb') {
    const res = await action('execute', file, code); const text = await res.text();
    expect(res.status, text).toBe(200);
    const messages = text.trim().split('\n').map(line => JSON.parse(line));
    expect(messages.at(-1), text).toEqual({ done: true }); return messages;
  }
  return { root, state, base, api, enable, action, execute };
}
describe('Notebook plugin API', () => {
  it('is disabled by default, persists settings, and creates valid notebooks without overwriting', async () => {
    const { api, enable, action, root, state } = await setup();
    expect((await (await api('plugins', 'GET')).json())[0]).toMatchObject({ id: 'yotram.notebook', enabled: false });
    expect((await action('create')).status).toBe(400);
    await enable('.venv/bin/python');
    expect((await action('create')).status).toBe(200);
    const saved = JSON.parse(await readFile(path.join(root, 'test.ipynb'), 'utf8'));
    expect(saved).toMatchObject({ nbformat: 4, nbformat_minor: 5, cells: [{ cell_type: 'code', outputs: [], execution_count: null }] });
    expect((await action('create')).status).toBe(400);
    expect(await (await action('status')).json()).toEqual({ status: 'stopped' });
    expect(await readFile(path.join(state, 'plugins.json'), 'utf8')).toContain('.venv/bin/python');
    await enable('.venv/bin/python', false);
    expect((await action('start')).status).toBe(400);
  });
  it('rejects path escapes, symlinks, unauthorized requests and foreign origins', async () => {
    const { base, api, enable, action, root, state } = await setup();
    await enable();
    expect((await action('create', '../outside.ipynb')).status).toBe(400);
    await symlink(state, path.join(root, 'outside'));
    expect((await action('create', 'outside/escape.ipynb')).status).toBe(400);
    expect((await fetch(base + '/api/workspaces/local/plugins')).status).toBe(401);
    expect((await api('notebooks/create', 'POST', { path: 'a.ipynb' }, { Origin: 'http://other.example' })).status).toBe(403);
    expect((await api('plugins/yotram.notebook', 'PUT', { enabled: true, settings: { unknown: 'x' } })).status).toBe(400);
  });
});

const python = process.env.YOTRAM_TEST_PYTHON;
describe.skipIf(!python)('real Jupyter execution', () => {
  it('streams results, keeps variables, isolates notebooks, displays HTML and plots, and reports Python errors', async () => {
    const { enable, action, execute } = await setup(); await enable(python); await action('create');
    const first = await execute('value = 21\nprint("hello notebook")\nvalue * 2');
    expect(first.some(m => m.event === 'stream' && m.content.text.includes('hello notebook'))).toBe(true);
    expect(first.find(m => m.event === 'execute_result').content.data['text/plain']).toBe('42');
    const next = await execute('value + 1');
    expect(next.find(m => m.event === 'execute_result').content.data['text/plain']).toBe('22');
    const rich = await execute('from IPython.display import display, HTML\ndisplay(HTML("<table><tr><td>Table value</td></tr></table>"))\n%matplotlib inline\nimport matplotlib.pyplot as plt\nplt.plot([1, 2], [3, 4])\nplt.show()');
    expect(rich.some(m => m.content?.data?.['text/html']?.includes('Table value'))).toBe(true);
    expect(rich.some(m => m.content?.data?.['image/png']?.length > 100)).toBe(true);
    expect((await execute('1 / 0')).some(m => m.event === 'error' && m.content.ename === 'ZeroDivisionError')).toBe(true);
    await action('create', 'other.ipynb');
    expect((await execute('value', 'other.ipynb')).some(m => m.event === 'error' && m.content.ename === 'NameError')).toBe(true);
    expect((await action('stop')).status).toBe(200);
    expect(await (await action('status')).json()).toEqual({ status: 'stopped' });
  }, 90000);
  it('interrupts a busy kernel, restarts its namespace, and shuts down when disabled', async () => {
    const { enable, action, execute } = await setup(); await enable(python); await action('create');
    await execute('remember = 7');
    const response = await action('execute', 'test.ipynb', 'import time\nprint("started", flush=True)\ntime.sleep(120)');
    const reader = response.body!.getReader();
    let output = '';
    while (!output.includes('started')) output += new TextDecoder().decode((await reader.read()).value);
    expect((await action('execute', 'test.ipynb', 'print("wrong")')).status).toBe(400);
    expect((await action('interrupt')).status).toBe(200);
    while (true) { const chunk = await reader.read(); if (chunk.done) break; output += new TextDecoder().decode(chunk.value); }
    expect(output).toContain('KeyboardInterrupt'); expect(output).toContain('"done":true');
    expect((await action('restart')).status).toBe(200);
    expect((await execute('remember')).some(m => m.event === 'error' && m.content.ename === 'NameError')).toBe(true);
    await enable(python, false); expect((await action('start')).status).toBe(400);
    await enable(python); expect(await (await action('status')).json()).toEqual({ status: 'stopped' });
  }, 90000);
  it('reports a missing environment and recovers after correcting settings', async () => {
    const { enable, action, execute } = await setup(); await enable('/missing/yotram-python'); await action('create');
    const response = await action('start'); expect(response.status).toBe(400); expect(await response.text()).toContain('Python');
    await enable(python); expect((await execute('6 * 7')).find(m => m.event === 'execute_result').content.data['text/plain']).toBe('42');
  }, 90000);
});
