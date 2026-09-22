import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { TEST_PASSWORD } from './testPassword';

export default defineConfig({
  testDir: '.',
  webServer: {
    command: 'node ../backend/dist/index.js ../e2e/fixture-workspace --port 4998',
    port: 4998,
    reuseExistingServer: false,
    env: { YOTRAM_PASSWORD: TEST_PASSWORD, YOTRAM_STATE_DIR: path.join(os.tmpdir(), `yotram-e2e-${process.pid}-${Date.now()}`) },
  },
  use: { baseURL: 'http://127.0.0.1:4998' },
});
