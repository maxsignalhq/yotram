import { readdir, readFile, writeFile, mkdir, rename, unlink, rmdir, lstat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import chokidar, { FSWatcher } from 'chokidar';

export class PathEscapeError extends Error {
  constructor(relPath: string) {
    super(`Path escapes workspace root: ${relPath}`);
    this.name = 'PathEscapeError';
  }
}

export class WorkspaceFs {
  private watcher?: FSWatcher;

  constructor(private readonly rootDir: string, private readonly ignoredRoot?: string) {}

  private resolve(relPath: string): string {
    const resolved = path.resolve(this.rootDir, relPath);
    const rel = path.relative(this.rootDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new PathEscapeError(relPath);
    }
    return resolved;
  }

  private async safePath(relPath: string): Promise<string> {
    const absolute = this.resolve(relPath);
    const root = await realpath(this.rootDir);
    let existing = absolute;
    while (true) {
      try {
        const actual = await realpath(existing);
        const relative = path.relative(root, actual);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new PathEscapeError(relPath);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        existing = path.dirname(existing);
      }
    }
    return absolute;
  }

  async create(relPath: string, directory: boolean, content = ''): Promise<void> {
    const absolute = await this.safePath(relPath);
    if (directory) await mkdir(absolute);
    else await writeFile(absolute, content, { flag: 'wx' });
  }

  async rename(relPath: string, destination: string): Promise<void> {
    if (this.resolve(relPath) === path.resolve(this.rootDir)) throw new Error('Cannot rename workspace root');
    const target = await this.safePath(destination);
    try { await lstat(target); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await rename(await this.safePath(relPath), target);
        return;
      }
      throw error;
    }
    throw new Error('Destination already exists');
  }

  async delete(relPath: string): Promise<void> {
    const absolute = await this.safePath(relPath);
    if (absolute === path.resolve(this.rootDir)) throw new Error('Cannot delete workspace root');
    const stat = await lstat(absolute);
    if (stat.isDirectory()) await rmdir(absolute);
    else await unlink(absolute);
  }

  async list(relPath: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const absolute = await this.safePath(relPath);
    const entries = await readdir(absolute, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  }

  async read(relPath: string): Promise<string> {
    return readFile(await this.safePath(relPath), 'utf-8');
  }

  async readBinary(relPath: string, maxBytes: number): Promise<Buffer> {
    const absolute = await this.safePath(relPath);
    const file = await open(absolute, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Choose a regular file');
      if (stat.size > maxBytes) throw new Error(`File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB preview limit`);
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      return buffer.subarray(0, offset);
    } finally { await file.close(); }
  }

  async write(relPath: string, content: string): Promise<void> {
    await writeFile(await this.safePath(relPath), content, 'utf-8');
  }

  watch(onEvent: (event: { path: string; kind: 'add' | 'change' | 'unlink' }) => void): () => void {
    const watcher = chokidar.watch(this.rootDir, { ignoreInitial: true, ignored: (file: string) => /(^|[/\\])(node_modules|\.git|\.yotram|\.claude|\.codex)([/\\]|$)/.test(file) || !!(this.ignoredRoot && (file === this.ignoredRoot || file.startsWith(this.ignoredRoot + path.sep))) });
    const relOf = (absolute: string) => path.relative(this.rootDir, absolute);
    watcher.on('addDir', (p) => onEvent({ path: relOf(p), kind: 'add' }));
    watcher.on('unlinkDir', (p) => onEvent({ path: relOf(p), kind: 'unlink' }));
    watcher.on('add', (p) => onEvent({ path: relOf(p), kind: 'add' }));
    watcher.on('change', (p) => onEvent({ path: relOf(p), kind: 'change' }));
    watcher.on('unlink', (p) => onEvent({ path: relOf(p), kind: 'unlink' }));
    this.watcher = watcher;
    return () => { watcher.close(); };
  }
}
