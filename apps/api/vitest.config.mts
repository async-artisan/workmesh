import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        '**/*.spec.ts',
        '**/*.test.ts',
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
        // 全局门槛：lines 保持 80；branches 取 2026-11-04 实测 66.17% 向下取整为 66。
        // 路径门槛（glob key）：值取同一份实测报告向下取整，只允许往上调。
        // 这些 SQL 仓储层此前被 80% 的全局平均值掩盖（个位数~28%），这里逐路径上棘轮。
        lines: 80,
        branches: 66,
        'src/tasks/v1-change.prisma-repository.ts': { lines: 4 },
        'src/projects/project-role.prisma-repository.ts': { lines: 4 },
        'src/tasks/v1-board.prisma-repository.ts': { lines: 12 },
        'src/tasks/v1-ready.prisma-repository.ts': { lines: 26, branches: 12 },
        'src/knowledge/v1-publication.prisma-repository.ts': { lines: 27, branches: 19 },
        'src/tasks/v1-artifact.prisma-repository.ts': { lines: 84, branches: 68 },
        'src/reviews/v1-review.prisma-repository.ts': { lines: 77, branches: 65 },
        'src/auth/**': { lines: 87, branches: 71 },
        'src/reviews/**': { lines: 81, branches: 68 },
      },
    },
  },
});
