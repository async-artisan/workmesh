import { defineConfig } from '@playwright/test';
import { checkTestDatabase } from './packages/shared/dist/index.js';

// Revalidate even when Playwright is invoked directly rather than through the runner.
const database = checkTestDatabase();
if (!database.ok) throw new Error(database.rejection.code);

const origin = 'http://127.0.0.1:55443';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './.tmp/browser-results',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  use: { baseURL: origin, browserName: 'chromium', headless: true },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:55442/api/health',
      reuseExistingServer: false,
      env: {
        WORKMESH_V1_DATABASE_URL: database.target.url,
        PORT: '55442',
        WORKMESH_COOKIE_MODE: 'LOCAL_INSECURE',
        WORKMESH_PUBLIC_ORIGIN: origin,
        WEB_ORIGIN: origin,
      },
    },
    {
      command: 'node scripts/box/web-server.mjs --root apps/web/dist --port 55443 --api-port 55442',
      url: origin,
      reuseExistingServer: false,
    },
  ],
});
