import os from 'node:os';
import path from 'node:path';
import { mkdirSync, closeSync, openSync, copyFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { TEST_PASSWORD } from './testPassword';

// Create a minimal PATH directory that includes node but not agent executables
const minimalPathDir = (() => {
  try {
    const dir = path.join(os.tmpdir(), `yotram-minimal-path-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    // Copy node from its location to our minimal directory
    const nodeExe = path.join(dir, 'node');
    copyFileSync('/opt/homebrew/bin/node', nodeExe);
    // Create non-executable stubs for claude and codex to prevent agent detection from finding them elsewhere
    closeSync(openSync(path.join(dir, 'claude'), 'w'));
    closeSync(openSync(path.join(dir, 'codex'), 'w'));
    return dir;
  } catch {
    return '';
  }
})();

export default defineConfig({
  testDir: '.',
  webServer: {
    command: 'node ../backend/dist/index.js ../e2e/fixture-workspace --port 4998',
    port: 4998,
    reuseExistingServer: false,
    env: {
      YOTRAM_PASSWORD: TEST_PASSWORD,
      YOTRAM_STATE_DIR: path.join(os.tmpdir(), `yotram-e2e-${process.pid}-${Date.now()}`),
      PATH: minimalPathDir ? `${minimalPathDir}:/usr/bin:/bin:/usr/sbin:/sbin` : process.env.PATH || '',
    },
  },
  use: { baseURL: 'http://127.0.0.1:4998' },
});
