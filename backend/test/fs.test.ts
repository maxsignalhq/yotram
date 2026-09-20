import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { WorkspaceFs, PathEscapeError } from '../src/fs.js';

let root: string;
let fs: WorkspaceFs;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yotram-fs-'));
  await writeFile(path.join(root, 'hello.txt'), 'hi there');
  fs = new WorkspaceFs(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('WorkspaceFs', () => {
  it('lists entries in the root', async () => {
    const entries = await fs.list('.');
    expect(entries).toContainEqual({ name: 'hello.txt', isDirectory: false });
  });

  it('reads a file relative to root', async () => {
    const content = await fs.read('hello.txt');
    expect(content).toBe('hi there');
  });

  it('writes a file relative to root', async () => {
    await fs.write('new.txt', 'new content');
    expect(await fs.read('new.txt')).toBe('new content');
  });

  it('rejects paths that escape the root', async () => {
    await expect(fs.read('../outside.txt')).rejects.toThrow(PathEscapeError);
  });
});

describe('WorkspaceFs.watch', () => {
  it('emits a change event when a watched file is modified', async () => {
    const events: { path: string; kind: string }[] = [];
    const unsubscribe = fs.watch((e) => events.push(e));
    await sleep(300); // chokidar initial scan
    await writeFile(path.join(root, 'hello.txt'), 'updated');
    await sleep(300);
    unsubscribe();
    expect(events.some((e) => e.path === 'hello.txt' && e.kind === 'change')).toBe(true);
  });
});
