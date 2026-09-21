import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import os from 'node:os';

export interface Session { id: string; agent: 'claude' | 'codex'; title: string; updatedAt: number }
export interface CodexScanLimits { matchLimit: number; scanLimit: number }

const DEFAULT_CODEX_LIMITS: CodexScanLimits = { matchLimit: 20, scanLimit: 500 };
const CLAUDE_MATCH_LIMIT = 20;

// Session ids flow, unmodified, into a shell command typed into a real PTY
// (see SessionsPanel.tsx's resumeCommand()). Both agents' ids are derived
// from attacker-controllable sources (a Claude session's filename; a Codex
// session file's self-reported session_id), so every id is validated against
// this loose UUID-shaped pattern before it's allowed into a returned
// Session. This is intentionally loose enough to tolerate variations across
// CLI versions, but strict enough to reject spaces, semicolons, pipes,
// backticks, `$()`, and other shell metacharacters.
const SESSION_ID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;

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

  // Title extraction requires reading every line of a file (to find the
  // LAST ai-title line), so it can't early-exit the way the Codex scan can.
  // To keep this bounded on a heavy user's history, stat every candidate
  // first (cheap), sort by recency, and only extract titles for the newest
  // CLAUDE_MATCH_LIMIT VALID files. Ids are validated before slicing (like
  // Codex validates before counting toward its match limit) so that a
  // handful of bogus/malicious filenames among the newest entries can't
  // push every legitimate older session out of the bound.
  const candidates: { id: string; filePath: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    const id = entry.slice(0, -'.jsonl'.length);
    // The id is derived directly from a filename in ~/.claude/projects/,
    // which an attacker (or a corrupted/synced/restored directory) fully
    // controls, and it later reaches a real shell — see SESSION_ID_PATTERN.
    if (!SESSION_ID_PATTERN.test(id)) continue;
    const filePath = path.join(dir, entry);
    try {
      const stats = await stat(filePath);
      candidates.push({ id, filePath, mtimeMs: stats.mtimeMs });
    } catch {
      // Skip a file we can't stat rather than failing the whole list.
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const sessions: Session[] = [];
  for (const candidate of candidates.slice(0, CLAUDE_MATCH_LIMIT)) {
    try {
      const title = await findLastClaudeTitle(candidate.filePath);
      sessions.push({ id: candidate.id, agent: 'claude', title: title ?? '(untitled session)', updatedAt: candidate.mtimeMs });
    } catch {
      // Skip a file we can't read rather than failing the whole list.
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
      // meta.sessionId is a self-reported string from inside the session
      // file's JSON payload and, like the Claude filename-derived id above,
      // later reaches a real shell — reject anything not UUID-shaped.
      if (!SESSION_ID_PATTERN.test(meta.sessionId)) continue;
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
