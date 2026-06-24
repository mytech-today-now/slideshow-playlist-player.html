import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4191);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000
  },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    viewport: { width: 1366, height: 900 }
  },
  webServer: {
    command: `node tests/e2e/fixture-server.mjs`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: String(PORT)
    }
  }
});
