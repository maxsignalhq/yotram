import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);

export type PrState = 'open' | 'merged' | 'closed';
export type PrChecks = 'pending' | 'passing' | 'failing' | 'none';

export async function ghAvailable(): Promise<boolean> {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    try { await access(path.join(directory, 'gh'), constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}

export function reduceChecks(rollup: { conclusion: string | null }[]): PrChecks {
  if (rollup.length === 0) return 'none';
  if (rollup.some(c => c.conclusion === 'FAILURE' || c.conclusion === 'CANCELLED' || c.conclusion === 'TIMED_OUT')) return 'failing';
  if (rollup.some(c => !c.conclusion)) return 'pending';
  return 'passing';
}

async function viewPr(url: string): Promise<{ state: PrState; checks: PrChecks }> {
  const { stdout } = await exec('gh', ['pr', 'view', url, '--json', 'state,statusCheckRollup']);
  const parsed = JSON.parse(stdout);
  return { state: String(parsed.state).toLowerCase() as PrState, checks: reduceChecks(parsed.statusCheckRollup ?? []) };
}

export async function createPullRequest(cwd: string, branch: string, base: string, title: string, body: string): Promise<{ url: string; state: PrState; checks: PrChecks }> {
  await exec('git', ['push', '-u', 'origin', branch], { cwd });
  const { stdout } = await exec('gh', ['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body', body], { cwd });
  const lines = stdout.trim().split('\n').filter(Boolean);
  const url = lines[lines.length - 1].trim();
  const status = await viewPr(url);
  return { url, ...status };
}

export async function fetchPullRequestStatus(prUrl: string): Promise<{ state: PrState; checks: PrChecks }> {
  return viewPr(prUrl);
}
