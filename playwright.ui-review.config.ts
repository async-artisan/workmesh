import { defineConfig } from '@playwright/test';

const port = Number(process.env.WORKMESH_UI_REVIEW_PORT ?? '55444');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('WORKMESH_UI_REVIEW_PORT must be an integer between 1 and 65535');
}
const baseURL = `http://127.0.0.1:${port}`;

/** UI contract fixtures only; no test may reach a live API or mutate business data. */
export default defineConfig({
  testDir: './tests/ui-review',
  outputDir: './.tmp/ui-review-results',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: '.tmp/ui-review-results/report.json' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm --filter @workmesh/web dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
