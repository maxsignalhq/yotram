import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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

  it('lists an untracked file with a space in its name, unquoted', async () => {
    await initRepo();
    await writeFile(path.join(root, 'my file.txt'), 'hi');
    const status = await git.status();
    expect(status.untracked).toEqual(['my file.txt']);
  });

  it('stages a space-named file successfully', async () => {
    await initRepo();
    await writeFile(path.join(root, 'my file.txt'), 'hi');
    await git.stage('my file.txt');
    const status = await git.status();
    expect(status.staged).toEqual(['my file.txt']);
    expect(status.untracked).toEqual([]);
  });

  it('returns real, non-empty diff content for a staged space-named file', async () => {
    await initRepo();
    await writeFile(path.join(root, 'my file.txt'), 'hello from a space file');
    await git.stage('my file.txt');
    const diff = await git.diff('my file.txt', true);
    expect(diff.before).toBe('');
    expect(diff.after).toBe('hello from a space file');
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

describe('Git path containment', () => {
  it('rejects diff, stage, and unstage for paths outside the workspace root', async () => {
    await initRepo();
    await expect(git.diff('../outside.txt', false)).rejects.toThrow();
    await expect(git.stage('../outside.txt')).rejects.toThrow();
    await expect(git.unstage('../outside.txt')).rejects.toThrow();
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

  it('rejects checkout of a flag-like non-branch name without invoking git', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'one');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    await writeFile(path.join(root, 'a.txt'), 'uncommitted edit');
    const before = await git.status();
    await expect(git.checkout('-f')).rejects.toThrow('Unknown branch: -f');
    const after = await git.status();
    expect(after.branch).toBe(before.branch);
    // -f would have discarded this uncommitted edit if it had reached git.
    expect(after.unstaged).toEqual(['a.txt']);
  });

  it('rejects checkout of a nonexistent branch name', async () => {
    await initRepo();
    await writeFile(path.join(root, 'a.txt'), 'one');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    await expect(git.checkout('does-not-exist')).rejects.toThrow('Unknown branch: does-not-exist');
    expect((await git.status()).branch).toBe('main');
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

describe('Git.history', () => {
  it('lists recent commits, changed paths, and text before/after content', async () => {
    await initRepo();
    await writeFile(path.join(root, 'notes.md'), 'first version\n');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'Add notes'], { cwd: root });
    await writeFile(path.join(root, 'notes.md'), 'second version\n');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'Update notes'], { cwd: root });

    const commits = await git.history(10);
    expect(commits.map(commit => commit.subject)).toEqual(['Update notes', 'Add notes']);
    expect(commits[0].author).toBe('Test');
    expect(commits[0].hash).toMatch(/^[0-9a-f]{40}$/);
    const files = await git.commitFiles(commits[0].hash);
    expect(files).toEqual([{ status: 'M', path: 'notes.md' }]);
    expect(await git.commitFileDiff(commits[0].hash, 'notes.md')).toEqual({ before: 'first version\n', after: 'second version\n' });
  });

  it('shows root commit files and rejects invalid ids or workspace escapes', async () => {
    await initRepo();
    await writeFile(path.join(root, 'new.txt'), 'new\n');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-q', '-m', 'First commit'], { cwd: root });
    const [commit] = await git.history();
    expect(await git.commitFiles(commit.hash)).toEqual([{ status: 'A', path: 'new.txt' }]);
    expect(await git.commitFileDiff(commit.hash, 'new.txt')).toEqual({ before: '', after: 'new\n' });
    await expect(git.commitFiles('not-a-commit')).rejects.toThrow('Invalid commit id');
    await expect(git.commitFileDiff(commit.hash, '../outside.txt')).rejects.toThrow();
  });

  it('keeps history and changed paths relative to a nested workspace', async () => {
    await initRepo();
    await mkdir(path.join(root, 'app'));
    await writeFile(path.join(root, 'outside.txt'), 'outside one');
    await writeFile(path.join(root, 'app', 'inside.txt'), 'inside one');
    await run('git', ['add', '.'], { cwd: root }); await run('git', ['commit', '-q', '-m', 'Initial files'], { cwd: root });
    await writeFile(path.join(root, 'outside.txt'), 'outside two');
    await run('git', ['add', '.'], { cwd: root }); await run('git', ['commit', '-q', '-m', 'Update outside'], { cwd: root });
    await writeFile(path.join(root, 'app', 'inside.txt'), 'inside two');
    await run('git', ['add', '.'], { cwd: root }); await run('git', ['commit', '-q', '-m', 'Update inside'], { cwd: root });
    const nestedGit = new Git(path.join(root, 'app'));
    const commits = await nestedGit.history();
    expect(commits.map(commit => commit.subject)).toEqual(['Update inside', 'Initial files']);
    expect(await nestedGit.commitFiles(commits[0].hash)).toEqual([{ status: 'M', path: 'inside.txt' }]);
    expect(await nestedGit.commitFileDiff(commits[0].hash, 'inside.txt')).toEqual({ before: 'inside one', after: 'inside two' });
  });
});
