import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspaces } from '../src/workspaces';
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'yotram-projects-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
it('creates a starter and reopens saved files through a fresh registry', async () => {
  const first = await new Workspaces(root).open('my-app', true);
  expect(await readFile(path.join(first.path, 'server.cjs'), 'utf8')).toContain('127.0.0.1');
  const next = await new Workspaces(root).open(first.path);
  expect(next).toEqual(first);
  await expect(new Workspaces(root).open('my-app', true)).rejects.toThrow();
  expect(await readFile(path.join(first.path, 'index.html'), 'utf8')).toContain('Hello from Yotram');
});
it('rejects files, missing folders and invalid input', async () => {
  const registry = new Workspaces(root);
  await expect(registry.open('missing')).rejects.toThrow();
  await expect(registry.open(null)).rejects.toThrow();
  await registry.open('app', true);
  await expect(registry.open('app/index.html')).rejects.toThrow('Choose a directory');
});
