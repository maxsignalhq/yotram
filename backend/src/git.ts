import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PathEscapeError } from './fs.js';

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface GitBranch { name: string; current: boolean }
export interface GitDiff { before: string; after: string }
export interface GitCommit { hash: string; author: string; authoredAt: string; subject: string }
export interface GitCommitFile { status: string; path: string; previousPath?: string }

export class Git {
  constructor(private readonly rootDir: string) {}

  private resolve(relPath: string): string {
    const resolved = path.resolve(this.rootDir, relPath);
    const rel = path.relative(this.rootDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new PathEscapeError(relPath);
    }
    return resolved;
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd: this.rootDir, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) { reject(new Error(stderr.trim() || error.message)); return; }
        resolve(stdout);
      });
    });
  }

  async status(): Promise<GitStatus> {
    let output: string;
    try {
      output = await this.run(['status', '--porcelain', '-z', '--branch']);
    } catch (error) {
      if (/not a git repository/i.test((error as Error).message)) {
        return { isRepo: false, branch: null, staged: [], unstaged: [], untracked: [] };
      }
      throw error;
    }
    // With -z, entries are NUL-terminated and paths are never C-quoted. Rename/copy
    // entries (status 'R'/'C' in the first column) are followed by an EXTRA
    // NUL-terminated token holding the old path, instead of the `old -> new` text
    // format used without -z.
    const tokens = output.split('\0');
    if (tokens[tokens.length - 1] === '') tokens.pop();
    let branch: string | null = null;
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const line = tokens[i];
      if (line.startsWith('## ')) {
        const rest = line.slice(3);
        if (rest.startsWith('No commits yet on ')) branch = rest.slice('No commits yet on '.length);
        else if (rest.startsWith('HEAD (no branch)')) branch = null;
        else branch = rest.split('...')[0];
        continue;
      }
      const x = line[0];
      const y = line[1];
      const filePath = line.slice(3);
      if (x === 'R' || x === 'C') i++; // skip the following old-path token
      if (x === '?' && y === '?') { untracked.push(filePath); continue; }
      if (x !== ' ') staged.push(filePath);
      if (y !== ' ') unstaged.push(filePath);
    }
    return { isRepo: true, branch, staged, unstaged, untracked };
  }

  async diff(filePath: string, staged: boolean): Promise<GitDiff> {
    this.resolve(filePath);
    // The `./` prefix makes git resolve <path> relative to `cwd` (this.rootDir)
    // rather than the repository's top level — required because an opened
    // Yotram workspace may be a subdirectory of a larger git repo, not the
    // repo root, and `<rev>:<path>` syntax defaults to repo-root-relative.
    const beforeRef = staged ? 'HEAD' : ':0';
    // Matches git's "doesn't exist at this ref" family of errors: the path isn't
    // present at <ref> (e.g. a new/untracked file), or, for a repo with no commits
    // yet, HEAD itself doesn't resolve to an object.
    const notFoundPattern = /does not exist in|fatal: path .* does not exist|invalid object name/i;
    let before = '';
    try { before = await this.run(['show', `${beforeRef}:./${filePath}`]); }
    catch (error) {
      // file doesn't exist at this ref yet (e.g. a new file) — anything else is a real error
      if (!notFoundPattern.test((error as Error).message)) throw error;
    }
    let after = '';
    if (staged) {
      try { after = await this.run(['show', `:0:./${filePath}`]); }
      catch (error) {
        // nothing staged for this path — anything else is a real error
        if (!notFoundPattern.test((error as Error).message)) throw error;
      }
    } else {
      try { after = await readFile(this.resolve(filePath), 'utf8'); }
      catch (error) {
        // file was deleted in the working tree — anything else is a real error
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return { before, after };
  }

  async stage(filePath: string): Promise<void> {
    this.resolve(filePath);
    await this.run(['add', '--', filePath]);
  }

  async unstage(filePath: string): Promise<void> {
    this.resolve(filePath);
    await this.run(['reset', 'HEAD', '--', filePath]);
  }

  async commit(message: string): Promise<void> {
    if (!message.trim()) throw new Error('Commit message is required');
    await this.run(['commit', '-m', message]);
  }

  async branches(): Promise<GitBranch[]> {
    const output = await this.run(['branch', '--format=%(refname:short)%09%(HEAD)']);
    return output.split('\n').filter(Boolean).map(line => {
      const [name, head] = line.split('\t');
      return { name, current: head === '*' };
    });
  }

  async checkout(name: string): Promise<void> {
    const branches = await this.branches();
    if (!branches.some(branch => branch.name === name)) {
      throw new Error(`Unknown branch: ${name}`);
    }
    await this.run(['checkout', name]);
  }

  async history(limit = 100): Promise<GitCommit[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const output = await this.run(['log', '--first-parent', '-z', `-n${boundedLimit}`, '--format=%H%x00%an%x00%aI%x00%s', '--', '.']);
    const fields = output.split('\0');
    if (fields.at(-1) === '') fields.pop();
    const commits: GitCommit[] = [];
    for (let i = 0; i + 3 < fields.length; i += 4) {
      commits.push({ hash: fields[i], author: fields[i + 1], authoredAt: fields[i + 2], subject: fields[i + 3] });
    }
    return commits;
  }

  async commitFiles(hash: string): Promise<GitCommitFile[]> {
    this.validateCommitHash(hash);
    await this.run(['cat-file', '-e', `${hash}^{commit}`]);
    const revision = (await this.run(['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/);
    const trees = revision.length > 1 ? [revision[1], hash] : ['--root', hash];
    const output = await this.run(['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', '-M', '--relative', ...trees, '--', '.']);
    const fields = output.split('\0').filter(Boolean);
    const files: GitCommitFile[] = [];
    for (let i = 0; i < fields.length;) {
      const status = fields[i++];
      if (/^[RC]\d+$/.test(status)) {
        const previousPath = fields[i++]; const filePath = fields[i++];
        if (previousPath !== undefined && filePath !== undefined) files.push({ status: status[0], path: filePath, previousPath });
      } else {
        const filePath = fields[i++];
        if (filePath !== undefined) files.push({ status, path: filePath });
      }
    }
    return files;
  }

  async commitFileDiff(hash: string, filePath: string, previousPath?: string): Promise<GitDiff> {
    this.validateCommitHash(hash);
    this.resolve(filePath);
    if (previousPath !== undefined) this.resolve(previousPath);
    await this.run(['cat-file', '-e', `${hash}^{commit}`]);
    const previous = previousPath ?? filePath;
    const show = async (spec: string): Promise<string> => {
      try { return await this.run(['show', spec]); }
      catch (error) {
        if (/does not exist in|fatal: path .* does not exist|invalid object name/i.test((error as Error).message)) return '';
        throw error;
      }
    };
    const before = await show(`${hash}^:./${previous}`);
    const after = await show(`${hash}:./${filePath}`);
    return { before, after };
  }

  private validateCommitHash(hash: string): void {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(hash)) throw new Error('Invalid commit id');
  }
}
