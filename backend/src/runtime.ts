import { PtyManager } from './pty.js';
import { WorkspaceFs } from './fs.js';
import type { Workspace } from './workspaces.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ActivityStore, privateFile } from './activity.js';
import type { ServerMessage } from './protocol.js';

export class Runtime {
  private disposed = false;
  readonly pty: PtyManager;
  readonly fs: WorkspaceFs;
  readonly unsubscribe: () => void;
  constructor(readonly workspace: Workspace, readonly store: ActivityStore, readonly publish: (message: ServerMessage) => void) {
    store.register(workspace);
    this.pty = new PtyManager(workspace.path);
    this.fs = new WorkspaceFs(workspace.path, store.directory);
    this.unsubscribe = this.fs.watch(event => {
      if (this.disposed) return;
      publish({ type: 'fs:watch-event', ...event });
      store.event(workspace.id, 'file', `${event.kind}: ${event.path}`, { file: event.path });
    });
  }
  create(id: string, cols: number, rows: number, command?: string): boolean {
    const created = this.pty.create(id, cols, rows,
      data => { if (this.disposed) return; this.store.output(this.workspace.id, id, data); this.publish({ type: 'pty:data', sessionId: id, data }); },
      exitCode => { if (this.disposed) return; this.store.event(this.workspace.id, 'exit', `Shell exited (${exitCode})`, { sessionId: id }); this.publish({ type: 'pty:exit', sessionId: id, exitCode }); this.list(); },
      (kind, value) => { if (this.disposed) return; this.store.event(this.workspace.id, kind, kind === 'complete' ? `Command finished (exit ${value})` : value, { sessionId: id }); this.publish({ type: 'pty:signal', sessionId: id, kind, value }); this.list(); if (kind === 'complete') void this.captureDiff(id); },
      command?.trim().split(/\s/)[0] || 'Shell');
    if (created) {
      this.store.event(this.workspace.id, 'session', 'Terminal started', { sessionId: id });
      if (command?.trim()) {
        this.store.event(this.workspace.id, 'command', command.trim(), { sessionId: id });
        this.pty.write(id, `{\n${command.trim()}\n}; printf '\\033]777;yotram;complete;%s\\007' "$?"\r`);
      }
      this.list();
    }
    return created;
  }
  private async captureDiff(sessionId: string): Promise<void> {
    const exec = promisify(execFile);
    try {
      const options = { cwd: this.workspace.path, maxBuffer: 1024 * 1024 };
      const names = (await exec('git', ['diff', '--name-only', '-z', 'HEAD'], options)).stdout.split('\0').filter(Boolean).filter(file => !privateFile(file));
      if (!names.length || this.disposed) return;
      const root = (await exec('git', ['rev-parse', '--show-toplevel'], options)).stdout.trim();
      const detail = (await exec('git', ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', ...names.slice(0, 100)], { ...options, cwd: root })).stdout;
      if (!this.disposed) this.store.event(this.workspace.id, 'changes', 'Tracked-file diff at command completion (timing does not prove authorship)', { sessionId, detail });
    } catch { /* Non-Git/unborn workspaces and oversized diffs remain available through explicit checkpoints. */ }
  }
  list(): void { this.publish({ type: 'pty:list', sessions: this.pty.list() }); }
  dispose(): void { if (this.disposed) return; for (const s of this.pty.list()) if (s.exitCode === undefined) this.store.event(this.workspace.id, 'interrupted', 'Shell stopped when Yotram shut down', { sessionId: s.id }); this.disposed = true; this.unsubscribe(); this.pty.dispose(); }
}
