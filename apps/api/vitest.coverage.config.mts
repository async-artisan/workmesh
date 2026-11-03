import { defineConfig } from 'vitest/config';
import { createIntegrationConfig } from './vitest.integration.config.mts';

// Collect one production-source report across unit, HTTP and database tests.
// The database guard remains active; CI must explicitly provide a test target.
export default defineConfig(() =>
  createIntegrationConfig(['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.e2e-spec.ts']),
);
