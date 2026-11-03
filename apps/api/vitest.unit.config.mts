import { defineConfig } from 'vitest/config';
import { createIntegrationConfig } from './vitest.integration.config.mts';

// Nest dependency injection must see the same decorator metadata as production.
export default defineConfig(() => createIntegrationConfig(['src/**/*.spec.ts']));
