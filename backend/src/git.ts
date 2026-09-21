import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface GitBranch { name: string; current: boolean }
export interface GitDiff { before: string; after: string }

export class Git {
  constructor(private readonly rootDir: string) {}

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
      output = await this.run(['status', '--porcelain', '--branch']);
    } catch (error) {
      if (/not a git repository/i.test((error as Error).message)) {
        return { isRepo: false, branch: null, staged: [], unstaged: [], untracked: [] };
      }
      throw error;
    }
    const lines = output.split('\n').filter(Boolean);
    let branch: string | null = null;
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];
    for (const line of lines) {
      if (line.startsWith('## ')) {
        const rest = line.slice(3);
        if (rest.startsWith('No commits yet on ')) branch = rest.slice('No commits yet on '.length);
        else if (rest.startsWith('HEAD (no branch)')) branch = null;
        else branch = rest.split('...')[0];
        continue;
      }
      const x = line[0];
      const y = line[1];
      let filePath = line.slice(3);
      if (filePath.includes(' -> ')) filePath = filePath.split(' -> ')[1];
      if (x === '?' && y === '?') { untracked.push(filePath); continue; }
      if (x !== ' ') staged.push(filePath);
      if (y !== ' ') unstaged.push(filePath);
    }
    return { isRepo: true, branch, staged, unstaged, untracked };
  }

  async diff(filePath: string, staged: boolean): Promise<GitDiff> {
    // The `./` prefix makes git resolve <path> relative to `cwd` (this.rootDir)
    // rather than the repository's top level — required because an opened
    // Yotram workspace may be a subdirectory of a larger git repo, not the
    // repo root, and `<rev>:<path>` syntax defaults to repo-root-relative.
    const beforeRef = staged ? 'HEAD' : ':0';
    let before = '';
    try { before = await this.run(['show', `${beforeRef}:./${filePath}`]); }
    catch { /* file doesn't exist at this ref yet (e.g. a new file) */ }
    let after = '';
    if (staged) {
      try { after = await this.run(['show', `:0:./${filePath}`]); }
      catch { /* nothing staged for this path */ }
    } else {
      try { after = await readFile(path.join(this.rootDir, filePath), 'utf8'); }
      catch { /* file was deleted in the working tree */ }
    }
    return { before, after };
  }

  async stage(filePath: string): Promise<void> {
    await this.run(['add', '--', filePath]);
  }

  async unstage(filePath: string): Promise<void> {
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
    await this.run(['checkout', name]);
  }
}
