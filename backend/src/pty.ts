import * as pty from 'node-pty';
import os from 'node:os';

interface Session {
  proc: pty.IPty;
}

export class PtyManager {
  constructor(private readonly cwd = process.cwd()) {}

  dispose(): void { for (const id of this.sessions.keys()) this.kill(id); }

  private sessions = new Map<string, Session>();

  create(
    sessionId: string,
    cols: number,
    rows: number,
    onData: (data: string) => void,
    onExit: (exitCode: number) => void,
  ): void {
    this.kill(sessionId);
    const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL ?? '/bin/bash');
    const proc = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols,
      rows,
      cwd: this.cwd,
      env: process.env as Record<string, string>,
    });
    proc.onData(onData);
    proc.onExit(({ exitCode }) => {
      if (this.sessions.get(sessionId)?.proc === proc) this.sessions.delete(sessionId);
      onExit(exitCode);
    });
    this.sessions.set(sessionId, { proc });
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.proc.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.proc.resize(cols, rows);
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.proc.kill();
      this.sessions.delete(sessionId);
    }
  }
}
