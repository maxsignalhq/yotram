import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import os from 'node:os';

export interface Session { id: string; agent: 'claude' | 'codex'; title: string; updatedAt: number }
export interface CodexScanLimits { matchLimit: number; scanLimit: number }

const DEFAULT_CODEX_LIMITS: CodexScanLimits = { matchLimit: 20, scanLimit: 500 };

export function mangleClaudePath(absolutePath: string): string {
  return absolutePath.replace(/[/.]/g, '-');
}

async function safeReaddir(dir: string): Promise<string[]> {
  try { return await readdir(dir); } catch { return []; }
}

async function safeSortedReaddirDesc(dir: string): Promise<string[]> {
  return (await safeReaddir(dir)).sort().reverse();
}

async function readFirstLine(filePath: string): Promise<string | null> {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  try {
    for await (const line of rl) return line;
  } finally {
    rl.close();
  }
  return null;
}

async function findLastClaudeTitle(filePath: string): Promise<string | null> {
  let lastTitle: string | null = null;
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (!parsed || typeof parsed !== 'object') continue;
      const record = parsed as Record<string, unknown>;
      if (record.type === 'ai-title' && typeof record.aiTitle === 'string') lastTitle = record.aiTitle;
    }
  } finally {
    rl.close();
  }
  return lastTitle;
}

export async function listClaudeSessions(
  workspacePath: string,
  claudeProjectsDir: string = path.join(os.homedir(), '.claude', 'projects'),
): Promise<Session[]> {
  const dir = path.join(claudeProjectsDir, mangleClaudePath(workspacePath));
  const entries = (await safeReaddir(dir)).filter(name => name.endsWith('.jsonl'));
  const sessions: Session[] = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry);
    try {
      const stats = await stat(filePath);
      const title = await findLastClaudeTitle(filePath);
      sessions.push({ id: entry.slice(0, -'.jsonl'.length), agent: 'claude', title: title ?? '(untitled session)', updatedAt: stats.mtimeMs });
    } catch {
      // Skip a file we can't stat or read rather than failing the whole list.
    }
  }
  return sessions;
}

function extractCodexSummaryText(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.type !== 'response_item') return null;
  const payload = record.payload as Record<string, unknown> | undefined;
  if (!payload || payload.type !== 'reasoning') return null;
  const summary = payload.summary;
  if (!Array.isArray(summary)) return null;
  for (const entry of summary) {
    if (entry && typeof entry === 'object') {
      const entryRecord = entry as Record<string, unknown>;
      if (entryRecord.type === 'summary_text' && typeof entryRecord.text === 'string') return entryRecord.text;
    }
  }
  return null;
}

async function findFirstCodexSummary(filePath: string): Promise<string | null> {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      const summary = extractCodexSummaryText(parsed);
      if (summary) return summary.length > 80 ? `${summary.slice(0, 80)}…` : summary;
    }
  } finally {
    rl.close();
  }
  return null;
}

async function readCodexSessionMeta(filePath: string): Promise<{ sessionId: string; cwd: string } | null> {
  const line = await readFirstLine(filePath);
  if (!line) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.type !== 'session_meta') return null;
  const payload = record.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload.session_id !== 'string' || typeof payload.cwd !== 'string') return null;
  return { sessionId: payload.session_id, cwd: payload.cwd };
}

async function collectCodexDayDirs(root: string): Promise<string[]> {
  const dayDirs: string[] = [];
  const years = await safeSortedReaddirDesc(root);
  for (const year of years) {
    const months = await safeSortedReaddirDesc(path.join(root, year));
    for (const month of months) {
      const days = await safeSortedReaddirDesc(path.join(root, year, month));
      for (const day of days) dayDirs.push(path.join(root, year, month, day));
    }
  }
  return dayDirs;
}

export async function listCodexSessions(
  workspacePath: string,
  codexSessionsDir: string = path.join(os.homedir(), '.codex', 'sessions'),
  limits: CodexScanLimits = DEFAULT_CODEX_LIMITS,
): Promise<Session[]> {
  const sessions: Session[] = [];
  let scanned = 0;
  const dayDirs = await collectCodexDayDirs(codexSessionsDir);
  for (const dayDir of dayDirs) {
    if (sessions.length >= limits.matchLimit || scanned >= limits.scanLimit) break;
    const files = (await safeReaddir(dayDir)).filter(name => name.endsWith('.jsonl'));
    for (const file of files) {
      if (sessions.length >= limits.matchLimit || scanned >= limits.scanLimit) break;
      scanned++;
      const filePath = path.join(dayDir, file);
      const meta = await readCodexSessionMeta(filePath);
      if (!meta || meta.cwd !== workspacePath) continue;
      const stats = await stat(filePath).catch(() => null);
      const title = await findFirstCodexSummary(filePath);
      sessions.push({ id: meta.sessionId, agent: 'codex', title: title ?? '(untitled session)', updatedAt: stats?.mtimeMs ?? Date.now() });
    }
  }
  return sessions;
}

export async function listSessions(
  workspacePath: string,
  claudeProjectsDir?: string,
  codexSessionsDir?: string,
  codexLimits?: CodexScanLimits,
): Promise<Session[]> {
  const [claude, codex] = await Promise.all([
    listClaudeSessions(workspacePath, claudeProjectsDir).catch(() => []),
    listCodexSessions(workspacePath, codexSessionsDir, codexLimits).catch(() => []),
  ]);
  return [...claude, ...codex].sort((a, b) => b.updatedAt - a.updatedAt);
}
