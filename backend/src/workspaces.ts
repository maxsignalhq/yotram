import { realpathSync } from 'node:fs';
import { mkdir, realpath, stat, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface Workspace { id: string; name: string; path: string }
export class Workspaces {
  private items = new Map<string, Workspace>();
  constructor(private readonly defaultPath: string) {
    try { this.defaultPath = realpathSync(defaultPath); } catch { /* Startup folder may be created shortly after launch. */ }
    defaultPath = this.defaultPath;
    const id = createHash('sha256').update(defaultPath).digest('hex').slice(0, 24);
    const workspace = { id, name: path.basename(defaultPath), path: defaultPath };
    this.items.set('local', workspace); this.items.set(id, workspace);
  }
  restore(workspaces: Workspace[]): void { for (const workspace of workspaces) this.items.set(workspace.id, workspace); }
  list(): Workspace[] { return [...new Map([...this.items.values()].map(w => [w.id, w])).values()]; }
  forget(id: string): void { if (id !== 'local') this.items.delete(id); }
  get(id: string): Workspace | undefined { return this.items.get(id); }
  async browse(input: unknown): Promise<{ path: string; parent: string; folders: string[] }> {
    const directory = await realpath(typeof input === 'string' && input.trim() ? path.resolve(this.defaultPath, input) : this.defaultPath);
    const entries = await readdir(directory, { withFileTypes: true });
    return { path: directory, parent: path.dirname(directory), folders: entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name).sort((a, b) => a.localeCompare(b)) };
  }
  async open(input: unknown, create = false): Promise<Workspace> {
    if (typeof input !== 'string' || !input.trim()) throw new Error('Enter a project folder path');
    const directory = path.resolve(this.defaultPath, input.trim());
    if (create) {
      await mkdir(directory);
      await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>My app</title></head><body><h1>Hello from Yotram</h1><p>Edit index.html to build your app.</p></body></html>');
      await writeFile(path.join(directory, 'server.cjs'), `const http = require('node:http');\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst port = Number(process.env.PORT || 3000);\nhttp.createServer((req, res) => {\n  res.setHeader('Content-Type', 'text/html; charset=utf-8');\n  fs.createReadStream(path.join(__dirname, 'index.html')).on('error', () => res.end('Unable to read index.html')).pipe(res);\n}).listen(port, '127.0.0.1', () => console.log('App running at http://127.0.0.1:' + port));\n`);
      await writeFile(path.join(directory, 'README.md'), '# My local app\n\nRun `node server.cjs` in the terminal, then open Preview on port 3000.\nEdit index.html and refresh the preview to see changes.\n');
    }
    const canonical = await realpath(directory);
    if (!(await stat(canonical)).isDirectory()) throw new Error('Choose a directory');
    const workspace = { id: createHash('sha256').update(canonical).digest('hex').slice(0, 24), name: path.basename(canonical), path: canonical };
    this.items.set(workspace.id, workspace);
    return workspace;
  }
}
