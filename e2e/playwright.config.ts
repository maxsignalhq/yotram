import { defineConfig } from '@playwright/test';
import { TEST_PASSWORD } from './testPassword';

export default defineConfig({
  testDir: '.',
  webServer: {
    command: 'node ../backend/dist/index.js ../e2e/fixture-workspace --port 4998',
    port: 4998,
    reuseExistingServer: false,
    env: { YOTRAM_PASSWORD: TEST_PASSWORD },
  },
  use: { baseURL: 'http://127.0.0.1:4998' },
});
