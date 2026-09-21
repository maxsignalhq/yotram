import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
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

describe('workspace mutations', () => {
  it('creates, renames and deletes nested files without overwriting existing files', async () => {
    await fs.create('src', true);
    await fs.create('src/a.ts', false);
    await fs.write('src/a.ts', 'const a = 1');
    await fs.rename('src/a.ts', 'src/b.ts');
    expect(await fs.read('src/b.ts')).toBe('const a = 1');
    await expect(fs.create('src/b.ts', false)).rejects.toThrow();
    await expect(fs.rename('hello.txt', 'src/b.ts')).rejects.toThrow();
    await expect(fs.delete('src')).rejects.toThrow();
    await fs.delete('src/b.ts');
    await fs.delete('src');
    await expect(fs.delete('.')).rejects.toThrow();
  });
  it('rejects symlinks outside the workspace', async () => {
    await symlink(tmpdir(), path.join(root, 'outside'));
    await expect(fs.list('outside')).rejects.toThrow(PathEscapeError);
    await expect(fs.create('outside/yotram-escape.txt', false)).rejects.toThrow(PathEscapeError);
  });
});
