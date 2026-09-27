import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const exec = promisify(execFile);
export interface ProcessInfo { pid: number; parent: number; cpu: number; memoryKB: number; elapsed: string; command: string; ports: number[] }
export async function processTable(): Promise<ProcessInfo[]> {
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,etime=,comm=']);
  return stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return match ? [{ pid: +match[1], parent: +match[2], cpu: +match[3], memoryKB: +match[4], elapsed: match[5], command: path.basename(match[6]), ports: [] }] : [];
  });
}
export function descendants(table: ProcessInfo[], pid: number): ProcessInfo[] {
  const ids = new Set([pid]); let changed = true;
  while (changed) { changed = false; for (const p of table) if (ids.has(p.parent) && !ids.has(p.pid)) { ids.add(p.pid); changed = true; } }
  return table.filter(p => ids.has(p.pid));
}
export async function ownedResources(pids: number[]): Promise<ProcessInfo[][]> {
  const table = await processTable();
  const groups = pids.map(pid => descendants(table, pid));
  const ids = [...new Set(groups.flat().map(p => p.pid))];
  if (!ids.length) return groups;
  try {
    const { stdout } = await exec('lsof', ['-nP', '-a', '-p', ids.join(','), '-iTCP', '-sTCP:LISTEN', '-FpFn'], { maxBuffer: 1024 * 1024 });
    let pid = 0;
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) pid = +line.slice(1);
      if (line.startsWith('n')) { const port = Number(line.match(/:(\d+)$/)?.[1]); if (port) for (const group of groups) { const p = group.find(p => p.pid === pid); if (p && !p.ports.includes(port)) p.ports.push(port); } }
    }
  } catch { /* lsof can return 1 for no listeners or may not be installed. */ }
  return groups;
}
export function agentSearchPath(): string {
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const localBin = path.join(os.homedir(), '.local', 'bin');
  if (!directories.includes(localBin)) directories.push(localBin);
  return directories.join(path.delimiter);
}
export async function installedAgents(): Promise<{ claude: boolean; codex: boolean }> {
  async function found(name: string) {
    for (const directory of agentSearchPath().split(path.delimiter)) {
      try { await access(path.join(directory, name), constants.X_OK); return true; } catch { /* next */ }
    }
    return false;
  }
  return { claude: await found('claude'), codex: await found('codex') };
}
