// @ts-check
module.exports = {
  testDir: './tests/benchmark',
  timeout: 120000, // 2 min for large files
  webServer: {
    command: 'npx serve . -p 3000',
    port: 3000,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:3000',
  },
};
