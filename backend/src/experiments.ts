import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { ActivityStore, privateFile } from './activity.js';
const exec = promisify(execFile);
export class Experiments {
  private busy = new Set<string>();
  constructor(private store: ActivityStore, private directory: string) {}
  async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) throw new Error('Another Git operation is in progress for this workspace.');
    this.busy.add(id); try { return await fn(); } finally { this.busy.delete(id); }
  }
  async git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await exec('git', args, { cwd, env: env ?? process.env, maxBuffer: 8 * 1024 * 1024 }); return stdout;
  }
  async checkpoint(id: string, label: string) {
    const record = this.store.get(id)!;
    const root = (await this.git(record.path, ['rev-parse', '--show-toplevel'])).trim();
    if ((await realpath(root)) !== (await realpath(record.path))) throw new Error('Open the Git repository root to create checkpoints or experiments.');
    const head = (await this.git(root, ['rev-parse', 'HEAD'])).trim();
    const temporary = await mkdtemp(path.join(tmpdir(), 'yotram-index-'));
    const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index') };
    try {
      await this.git(root, ['read-tree', head], env);
      // Tracked private files remain at HEAD. Never record new private/ignored files.
      const files = (await this.git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean).filter(file => !privateFile(file));
      for (let i = 0; i < files.length; i += 100) await this.git(root, ['add', '-A', '--', ...files.slice(i, i + 100)], env);
      const tree = (await this.git(root, ['write-tree'], env)).trim();
      const commit = (await this.git(root, ['-c', 'user.name=Yotram', '-c', 'user.email=local@yotram', 'commit-tree', tree, '-p', head, '-m', label])).trim();
      const checkpointId = randomUUID();
      await this.git(root, ['update-ref', `refs/yotram/checkpoints/${checkpointId}`, commit]);
      const patch = await this.git(root, ['diff', '--no-ext-diff', '--no-textconv', head, commit]);
      const result = { id: checkpointId, at: Date.now(), label, ref: commit, patch: patch.slice(0, 250000) };
      record.checkpoints.push(result); this.store.changed();
      this.store.event(id, 'checkpoint', label, { detail: result.patch });
      return result;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  async create(id: string, name: string, checkpointId?: string) {
    const record = this.store.get(id)!;
    const root = (await this.git(record.path, ['rev-parse', '--show-toplevel'])).trim();
    if ((await realpath(root)) !== (await realpath(record.path))) throw new Error('Open the repository root before creating an experiment.');
    let base: string;
    if (checkpointId) {
      const checkpoint = record.checkpoints.find(c => c.id === checkpointId); if (!checkpoint) throw new Error('Checkpoint no longer exists.'); base = checkpoint.ref;
    } else {
      if ((await this.git(root, ['status', '--porcelain'])).trim()) throw new Error('Uncommitted changes found. Create and select a checkpoint, or commit your work first. Nothing has been omitted.');
      base = (await this.git(root, ['rev-parse', 'HEAD'])).trim();
    }
    const experimentId = randomUUID();
    const directory = path.join(this.directory, experimentId);
    await mkdir(this.directory, { recursive: true });
    const port = await new Promise<number>((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : 3000; server.close(() => resolve(port)); }); });
    const branch = `yotram/experiment-${experimentId.slice(0, 8)}`;
    await this.git(root, ['worktree', 'add', '-b', branch, directory, base]);
    const result = { id: experimentId, name, path: directory, branch, base, at: Date.now(), port };
    record.experiments.push(result); this.store.changed(); this.store.event(id, 'experiment', `Created experiment: ${name}`);
    return result;
  }
  async compare(id: string, experimentId: string) {
    const record = this.store.get(id)!;
    const experiment = record.experiments.find(e => e.id === experimentId); if (!experiment) throw new Error('Unknown experiment');
    // Snapshot comparison includes tracked and non-private untracked edits without changing its index.
    // Use a temporary index directly, so comparison creates no history/ref artifacts.
    const temporary = await mkdtemp(path.join(tmpdir(), 'yotram-compare-'));
    try {
      const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index') };
      await this.git(experiment.path, ['read-tree', 'HEAD'], env);
      const files = (await this.git(experiment.path, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean).filter(f => !privateFile(f));
      for (let i = 0; i < files.length; i += 100) await this.git(experiment.path, ['add', '-A', '--', ...files.slice(i, i + 100)], env);
      return await this.git(experiment.path, ['diff', '--cached', '--no-ext-diff', '--no-textconv', experiment.base], env);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  async merge(id: string, experimentId: string) {
    const record = this.store.get(id)!;
    const experiment = record.experiments.find(e => e.id === experimentId); if (!experiment) throw new Error('Unknown experiment');
    for (const folder of [record.path, experiment.path]) if ((await this.git(folder, ['status', '--porcelain'])).trim()) throw new Error('Commit changes in both workspaces before merging.');
    try { await this.git(record.path, ['merge', '--no-edit', experiment.branch]); }
    catch (error) { throw new Error(`Merge did not complete. Review Git status; resolve any conflicts and commit, or run git merge --abort in the original workspace. ${(error as Error).message}`); }
    this.store.event(id, 'experiment', `Merged ${experiment.name}`);
  }
  async discard(id: string, experimentId: string, force: boolean) {
    const record = this.store.get(id)!;
    const experiment = record.experiments.find(e => e.id === experimentId); if (!experiment) throw new Error('Unknown experiment');
    if (!force) throw new Error('Confirm discard to remove this experiment and its uncommitted files.');
    await this.git(record.path, ['worktree', 'remove', '--force', experiment.path]);
    await this.git(record.path, ['branch', '-D', experiment.branch]);
    record.experiments = record.experiments.filter(e => e.id !== experimentId); this.store.changed();
    this.store.event(id, 'experiment', `Discarded ${experiment.name}`);
  }
}
