import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class PathEscapeError extends Error {
  constructor(relPath: string) {
    super(`Path escapes workspace root: ${relPath}`);
    this.name = 'PathEscapeError';
  }
}

export class WorkspaceFs {
  constructor(private readonly rootDir: string) {}

  private resolve(relPath: string): string {
    const resolved = path.resolve(this.rootDir, relPath);
    const rel = path.relative(this.rootDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new PathEscapeError(relPath);
    }
    return resolved;
  }

  async list(relPath: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const absolute = this.resolve(relPath);
    const entries = await readdir(absolute, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  }

  async read(relPath: string): Promise<string> {
    return readFile(this.resolve(relPath), 'utf-8');
  }

  async write(relPath: string, content: string): Promise<void> {
    await writeFile(this.resolve(relPath), content, 'utf-8');
  }
}
