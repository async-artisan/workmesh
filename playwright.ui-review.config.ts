import { defineConfig } from '@playwright/test';

/** UI contract fixtures only; no test may reach a live API or mutate business data. */
export default defineConfig({
  testDir: './tests/ui-review',
  outputDir: './.tmp/ui-review-results',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: '.tmp/ui-review-results/report.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @workmesh/web dev --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
});
