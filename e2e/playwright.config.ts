import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  webServer: {
    command: 'node ../backend/dist/index.js ../e2e/fixture-workspace --port 4998',
    port: 4998,
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:4998' },
});
