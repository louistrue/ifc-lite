import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/benchmark',
  timeout: 180000, // 3 min for large files
  webServer: {
    command: 'npx serve . -p 3333',
    port: 3333,
    reuseExistingServer: true,
    timeout: 30000,
  },
  use: {
    baseURL: 'http://localhost:3333',
  },
});
