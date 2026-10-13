import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4191);
const OUTPUT_DIR = process.env.PLAYWRIGHT_TEST_OUTPUT_DIR || 'test-results';
const HTML_REPORT_DIR = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR || 'playwright-report';
const FIXTURE_SERVER_ENV = { ...process.env };
for (const name of Object.keys(FIXTURE_SERVER_ENV)) {
  if (/^BLEND_(?:GITHUB|BITBUCKET)_SMOKE_/.test(name)) delete FIXTURE_SERVER_ENV[name];
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000
  },
  fullyParallel: false,
  respectGitIgnore: false,
  retries: process.env.CI ? 1 : 0,
  outputDir: OUTPUT_DIR,
  reporter: [
    ['list'],
    ['html', { outputFolder: HTML_REPORT_DIR, open: 'never' }]
  ],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' }
    },
    {
      name: 'firefox',
      testMatch: /(?:browser-compatibility|add-files-selection-limit|thumbnail-failures|directory-scan-visibility|experience-import-atomicity|save-lifecycle|pwa-offline)\.e2e\.spec\.mjs$/,
      grep: /@cross-engine-smoke/,
      use: { browserName: 'firefox' }
    },
    {
      name: 'webkit',
      testMatch: /(?:browser-compatibility|add-files-selection-limit|thumbnail-failures|directory-scan-visibility|experience-import-atomicity|save-lifecycle|pwa-offline)\.e2e\.spec\.mjs$/,
      grep: /@cross-engine-smoke/,
      use: { browserName: 'webkit' }
    }
  ],
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
      ...FIXTURE_SERVER_ENV,
      PORT: String(PORT)
    }
  }
});
