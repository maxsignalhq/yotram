import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ActivityEvent { id: string; at: number; kind: string; summary: string; sessionId?: string; file?: string; detail?: string }
export interface Handoff { id: string; at: number; note: string; next: string; file?: string; port?: number; sessionId?: string; checkpointId?: string; branch?: string }
export interface Checkpoint { id: string; at: number; label: string; ref: string; patch: string }
export interface Experiment { id: string; name: string; path: string; branch: string; base: string; at: number; port: number }
export interface WorkspaceRecord { forgotten?: boolean; id: string; name: string; path: string; events: ActivityEvent[]; handoffs: Handoff[]; checkpoints: Checkpoint[]; experiments: Experiment[]; output: Record<string, string>; outputAt?: Record<string, number>; retentionDays: number }
export const privateFile = (name: string) => /(^|[/\\])(\.env(?:\..*)?|[^/\\]*\.(?:pem|key|p12)|credentials(?:\.[^/\\]*)?|secrets?(?:\.[^/\\]*)?)([/\\]|$)/i.test(name);
export function redact(text: string): string {
  return text.replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{16,})\b/g, '[redacted]').replace(/((?:password|api[_-]?key|token|secret)\s*[=:]\s*)[^\s]+/gi, '$1[redacted]');
}

/** Small single-process store. Atomic replacement, bounded records, owner-only permissions. */
export class ActivityStore {
  private records: Record<string, WorkspaceRecord> = {};
  persistenceError?: string;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(readonly directory?: string) {
    if (directory) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      try { this.records = JSON.parse(readFileSync(path.join(directory, 'workspaces.json'), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to read workspace history; preserve or repair workspaces.json before starting.'); }
    }
  }
  all(): WorkspaceRecord[] { return Object.values(this.records); }
  get(id: string): WorkspaceRecord | undefined { return this.records[id]; }
  register(workspace: { id: string; name: string; path: string }): WorkspaceRecord {
    if (!this.records[workspace.id]) {
      this.records[workspace.id] = { ...workspace, events: [], handoffs: [], checkpoints: [], experiments: [], output: {}, retentionDays: 30 };
      this.changed();
    }
    if (this.records[workspace.id].forgotten) { this.records[workspace.id].forgotten = false; this.changed(); }
    return this.records[workspace.id];
  }
  event(id: string, kind: string, summary: string, extra: Partial<ActivityEvent> = {}): void {
    const record = this.records[id];
    if (!record || (extra.file && privateFile(extra.file))) return;
    const previous = record.events.at(-1);
    if (kind === 'file' && previous?.kind === kind && previous.file === extra.file && Date.now() - previous.at < 1500) return;
    record.events.push({ ...extra, id: randomUUID(), at: Date.now(), kind, summary: redact(summary), detail: extra.detail ? redact(extra.detail).slice(-16000) : undefined });
    this.prune(record); this.changed();
  }
  output(id: string, sessionId: string, chunk: string): void {
    const record = this.records[id]; if (!record) return;
    (record.outputAt ??= {})[sessionId] = Date.now();
    record.output[sessionId] = redact((record.output[sessionId] ?? '') + chunk).slice(-65536);
    const keys = Object.keys(record.output); while (keys.length > 50) delete record.output[keys.shift()!];
    this.changed();
  }
  prune(record: WorkspaceRecord): void {
    const cutoff = Date.now() - record.retentionDays * 86400000;
    for (const [session, at] of Object.entries(record.outputAt ?? {})) if (at < cutoff) { delete record.output[session]; delete record.outputAt![session]; }
    const expired = new Set(record.events.filter(e => e.at < cutoff && e.sessionId).map(e => e.sessionId!));
    for (const session of expired) if (!record.events.some(e => e.sessionId === session && e.at >= cutoff)) delete record.output[session];
    record.events = record.events.filter(event => event.at >= Date.now() - record.retentionDays * 86400000).slice(-2000);
  }
  changed(): void {
    if (!this.timer && this.directory) this.timer = setTimeout(() => { try { this.flush(); } catch (error) { this.persistenceError = (error as Error).message; console.error('Unable to persist workspace history:', this.persistenceError); } }, 300);
  }
  flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.directory) return;
    for (const record of this.all()) this.prune(record);
    const target = path.join(this.directory, 'workspaces.json');
    writeFileSync(`${target}.tmp`, JSON.stringify(this.records), { mode: 0o600 });
    renameSync(`${target}.tmp`, target);
    this.persistenceError = undefined;
  }
}
