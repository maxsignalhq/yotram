import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);

function noPromptEnv() { return { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' }; }

export type PrState = 'open' | 'merged' | 'closed';
export type PrChecks = 'pending' | 'passing' | 'failing' | 'none';

export async function ghAvailable(): Promise<boolean> {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    try { await access(path.join(directory, 'gh'), constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}

export function reduceChecks(rollup: { conclusion: string | null; state?: string | null }[]): PrChecks {
  if (rollup.length === 0) return 'none';
  const status = (c: { conclusion: string | null; state?: string | null }) => c.conclusion ?? c.state ?? null;
  const FAILING = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
  const PENDING = new Set(['PENDING', 'EXPECTED']);
  if (rollup.some(c => FAILING.has(status(c) ?? ''))) return 'failing';
  if (rollup.some(c => { const s = status(c); return s === null || PENDING.has(s); })) return 'pending';
  return 'passing';
}

async function viewPr(url: string): Promise<{ state: PrState; checks: PrChecks }> {
  const { stdout } = await exec('gh', ['pr', 'view', url, '--json', 'state,statusCheckRollup'], { env: noPromptEnv(), timeout: 30000 });
  const parsed = JSON.parse(stdout);
  return { state: String(parsed.state).toLowerCase() as PrState, checks: reduceChecks(parsed.statusCheckRollup ?? []) };
}

export async function createPullRequest(cwd: string, branch: string, base: string, title: string, body: string): Promise<{ url: string; state: PrState; checks: PrChecks }> {
  await exec('git', ['push', '-u', 'origin', branch], { cwd, env: noPromptEnv(), timeout: 30000 });
  const { stdout } = await exec('gh', ['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body', body], { cwd, env: noPromptEnv(), timeout: 30000 });
  const lines = stdout.trim().split('\n').filter(Boolean);
  const url = lines[lines.length - 1].trim();
  try {
    const status = await viewPr(url);
    return { url, ...status };
  } catch {
    return { url, state: 'open', checks: 'none' };
  }
}

export async function fetchPullRequestStatus(prUrl: string): Promise<{ state: PrState; checks: PrChecks }> {
  return viewPr(prUrl);
}
