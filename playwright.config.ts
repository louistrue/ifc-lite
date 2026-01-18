import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/benchmark',
  timeout: 180000, // 3 min for large files
  workers: 3, // Run tests in parallel with 3 workers
  fullyParallel: true, // Enable parallel execution of tests within the same file
  projects: [
    {
      name: 'browser-benchmark',
      testMatch: /benchmark\.spec\.ts/,
      webServer: {
        command: 'npx serve . -p 3333',
        port: 3333,
        reuseExistingServer: true,
        timeout: 30000,
      },
      use: {
        baseURL: 'http://localhost:3333',
      },
    },
    {
      name: 'viewer-benchmark',
      testMatch: /viewer-benchmark\.spec\.ts/,
      timeout: 600000, // 10 min for very large files (327MB)
      webServer: {
        command: 'pnpm --filter viewer dev',
        port: 3000,
        reuseExistingServer: true,
        timeout: 60000,
        env: {
          // Disable auto-open browser
          BROWSER: 'none',
        },
      },
      use: {
        baseURL: 'http://localhost:3000',
        // Use slower action timeout for large file operations
        actionTimeout: 300000,
      },
    },
    {
      name: 'zero-copy-benchmark',
      testMatch: /zero-copy-benchmark\.spec\.ts/,
      webServer: {
        command: 'npx serve . -p 3333',
        port: 3333,
        reuseExistingServer: true,
        timeout: 30000,
      },
      use: {
        baseURL: 'http://localhost:3333',
      },
    },
  ],
});
