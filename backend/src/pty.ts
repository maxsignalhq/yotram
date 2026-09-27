import * as pty from 'node-pty';
import os from 'node:os';
import { agentSearchPath, descendants, processTable } from './resources.js';

interface Session { proc: pty.IPty; output: string; startedAt: number; exitCode?: number; attention?: string; label: string }
export class PtyManager {
  constructor(private readonly cwd = process.cwd()) {}
  private sessions = new Map<string, Session>();
  dispose(): void { for (const s of this.sessions.values()) if (s.exitCode === undefined) { try { s.proc.kill(); } catch { /* already exited */ } } this.sessions.clear(); }
  list() { return [...this.sessions].map(([id, s]) => ({ id, pid: s.proc.pid, startedAt: s.startedAt, exitCode: s.exitCode, attention: s.attention, label: s.label })); }
  has(id: string): boolean { return this.sessions.has(id); }
  replay(id: string): string { return this.sessions.get(id)?.output ?? ''; }
  acknowledge(id: string): void { const s = this.sessions.get(id); if (s) s.attention = undefined; }
  create(sessionId: string, cols: number, rows: number, onData: (data: string) => void, onExit: (exitCode: number) => void, onSignal?: (kind: string, value: string) => void, label = 'Shell'): boolean {
    if (this.sessions.has(sessionId)) return false;
    if (this.sessions.size >= 50) throw new Error('Close old terminal sessions before starting more (limit 50).');
    const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL ?? '/bin/bash');
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: agentSearchPath() }; delete env.YOTRAM_PASSWORD;
    const proc = pty.spawn(shell, [], { name: 'xterm-color', cols, rows, cwd: this.cwd, env: env as Record<string, string> });
    const session: Session = { proc, output: '', startedAt: Date.now(), label };
    this.sessions.set(sessionId, session);
    let pending = '';
    proc.onData(data => {
      session.output = (session.output + data).slice(-131072);
      onData(data);
      pending = (pending + data).slice(-8192);
      const pattern = /\x1b\]777;yotram;(attention|complete);([^\x07]*)\x07/g;
      let match: RegExpExecArray | null;
      let end = 0;
      while ((match = pattern.exec(pending))) {
        if (match[1] === 'attention') session.attention = match[2].slice(0, 200);
        if (match[1] === 'complete') session.attention = `Command finished (exit ${match[2]})`;
        onSignal?.(match[1], match[2]); end = pattern.lastIndex;
      }
      if (end) pending = pending.slice(end);
    });
    proc.onExit(({ exitCode }) => { session.exitCode = exitCode; session.attention = `Shell exited (${exitCode})`; onExit(exitCode); });
    return true;
  }
  write(id: string, data: string): void { const s = this.sessions.get(id); if (s && s.exitCode === undefined) s.proc.write(data); }
  resize(id: string, cols: number, rows: number): void { const s = this.sessions.get(id); if (s && s.exitCode === undefined) s.proc.resize(cols, rows); }
  kill(id: string): void { const s = this.sessions.get(id); if (s && s.exitCode === undefined) s.proc.kill(); this.sessions.delete(id); }
  async stop(id: string, force = false): Promise<void> {
    const session = this.sessions.get(id); if (!session || session.exitCode !== undefined) return;
    const owned = descendants(await processTable(), session.proc.pid).reverse();
    if (this.sessions.get(id) !== session || session.exitCode !== undefined) return;
    for (const proc of owned) { try { process.kill(proc.pid, force ? 'SIGKILL' : 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
    if (session.exitCode === undefined) { try { session.proc.kill(force ? 'SIGKILL' : 'SIGHUP'); } catch { /* exited */ } }
  }
}
