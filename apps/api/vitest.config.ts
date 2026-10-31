import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'dist/**',
        'coverage/**',
        'test/**',
        'prisma/**',
        '**/*.config.ts',
        'src/**/*.module.ts',
        'src/**/*.dto.ts',
        'src/app.module.ts',
        'src/main.ts',
        'src/prisma/prisma.service.ts',
      ],
      thresholds: {
        lines: 80,
      },
    },
  },
});
