import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentSearchPath, installedAgents } from '../src/resources.js';
import { PtyManager } from '../src/pty.js';

let root: string | undefined;
let manager: PtyManager | undefined;
afterEach(async () => {
  manager?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

it('detects and launches a user-local agent when the server PATH omits it', async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'yotram-agent-discovery-'));
  const bin = path.join(root, '.local', 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'claude'), '#!/bin/sh\nprintf "agent-launch-verified\\n"\n', { mode: 0o755 });
  vi.spyOn(os, 'homedir').mockReturnValue(root);
  vi.stubEnv('PATH', '/usr/bin:/bin');
  vi.stubEnv('SHELL', '/bin/sh');
  expect(agentSearchPath()).toBe(`/usr/bin:/bin:${bin}`);
  expect(await installedAgents()).toEqual({ claude: true, codex: false });
  manager = new PtyManager(root);
  let output = '';
  manager.create('agent', 80, 24, data => { output += data; }, () => {});
  manager.write('agent', 'claude\r');
  await vi.waitFor(() => expect(output).toContain('agent-launch-verified'), { timeout: 5000 });
});
