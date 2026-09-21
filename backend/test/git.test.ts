import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Git } from '../src/git.js';

const run = promisify(execFile);

let root: string;
let git: Git;

async function initRepo(): Promise<void> {
  await run('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await run('git', ['config', 'user.name', 'Test'], { cwd: root });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yotram-git-'));
  git = new Git(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Git.status', () => {
  it('reports isRepo: false for a plain directory', async () => {
    const status = await git.status();
    expect(status.isRepo).toBe(false);
  });

  it('reports the branch name and no changes for a fresh empty repo', async () => {
    await initRepo();
    const status = await git.status();
    expect(status).toEqual({ isRepo: true, branch: 'main', staged: [], unstaged: [], untracked: [] });
  });

  it('lists an untracked file', async () => {
    await initRepo();
    await writeFile(path.join(root, 'new.txt'), 'hi');
    const status = await git.status();
    expect(status.untracked).toEqual(['new.txt']);
  });

  it('separates staged from unstaged changes to a tracked file', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'one');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    await writeFile(path.join(root, 'a.txt'), 'two');
    await git.stage('a.txt');
    await writeFile(path.join(root, 'a.txt'), 'three');
    const status = await git.status();
    expect(status.staged).toEqual(['a.txt']);
    expect(status.unstaged).toEqual(['a.txt']);
  });
});

describe('Git.stage / unstage', () => {
  it('moves a file from untracked to staged and back', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'one');
    await git.stage('a.txt');
    expect((await git.status()).staged).toEqual(['a.txt']);
    await git.unstage('a.txt');
    const status = await git.status();
    expect(status.staged).toEqual([]);
    expect(status.untracked).toEqual(['a.txt']);
  });
});

describe('Git.diff', () => {
  it('returns before/after content for an unstaged change', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'original');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    await writeFile(path.join(root, 'a.txt'), 'edited');
    const diff = await git.diff('a.txt', false);
    expect(diff).toEqual({ before: 'original', after: 'edited' });
  });

  it('returns before/after content for a staged change', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'original');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    await writeFile(path.join(root, 'a.txt'), 'edited');
    await git.stage('a.txt');
    const diff = await git.diff('a.txt', true);
    expect(diff).toEqual({ before: 'original', after: 'edited' });
  });

  it('returns empty before-content for a new untracked file staged then diffed', async () => {
    await initRepo();
    await writeFile(path.join(root, 'new.txt'), 'brand new');
    await git.stage('new.txt');
    const diff = await git.diff('new.txt', true);
    expect(diff).toEqual({ before: '', after: 'brand new' });
  });
});

describe('Git.commit', () => {
  it('commits staged changes and clears status', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'one');
    await git.stage('a.txt');
    await git.commit('add a.txt');
    const status = await git.status();
    expect(status.staged).toEqual([]);
    expect(status.unstaged).toEqual([]);
  });

  it('rejects a commit with nothing staged', async () => {
    await initRepo();
    await expect(git.commit('empty commit')).rejects.toThrow();
  });

  it('rejects an empty commit message', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'one');
    await git.stage('a.txt');
    await expect(git.commit('  ')).rejects.toThrow('Commit message is required');
  });
});

describe('Git.branches / checkout', () => {
  it('lists branches and marks the current one', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'one');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    await run('git', ['branch', 'feature'], { cwd: root });
    const branches = await git.branches();
    expect(branches).toEqual(expect.arrayContaining([
      { name: 'main', current: true },
      { name: 'feature', current: false },
    ]));
  });

  it('checks out another branch', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'one');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    await run('git', ['branch', 'feature'], { cwd: root });
    await git.checkout('feature');
    const status = await git.status();
    expect(status.branch).toBe('feature');
  });

  it('rejects checkout with conflicting uncommitted changes, without switching', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'one');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    await run('git', ['checkout', '-q', '-b', 'feature'], { cwd: root });
    await writeFile(path.join(root, 'a.txt'), 'feature version');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'feature'], { cwd: root });
    await run('git', ['checkout', '-q', 'main'], { cwd: root });
    await writeFile(path.join(root, 'a.txt'), 'uncommitted local edit');
    await expect(git.checkout('feature')).rejects.toThrow();
    expect((await git.status()).branch).toBe('main');
  });
});
