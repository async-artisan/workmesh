import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config.mts';

// Vitest 默认用 esbuild 转译，而 esbuild 不发射 `design:paramtypes` 装饰器元数据。
// 这会使 Nest 的两类行为在测试进程内静默失效：
//   1) 类型化构造注入（已用显式 @Inject 缓解）；
//   2) ValidationPipe 无法推断 @Body() 的 DTO 类型 → DTO 校验（forbidNonWhitelisted / @IsUUID / @Type 嵌套）整体失效。
// 因此集成测试（契约 + E2E）改用 SWC 转译并显式发射装饰器元数据，使其与生产 tsc 构建行为一致。
export async function createIntegrationConfig(
  include = ['test/**/*.e2e-spec.ts', 'test/**/*.spec.ts'],
) {
  // Keep this ESM-only plugin on the dynamic import path even when Vite loads
  // this configuration through its CommonJS config loader.
  const { default: swc } = await import('unplugin-swc');
  return mergeConfig(
    // mergeConfig concatenates arrays; clear the unit-test include before
    // adding integration patterns so the dedicated command runs only test/**.
    { ...baseConfig, test: { ...baseConfig.test, include: [] } },
    defineConfig({
      plugins: [
        swc.vite({
          jsc: {
            parser: { syntax: 'typescript', decorators: true },
            transform: {
              legacyDecorator: true,
              decoratorMetadata: true,
              useDefineForClassFields: false,
            },
            target: 'es2021',
          },
        }),
      ],
      esbuild: {
        exclude: [/\.ts$/],
      },
      test: {
        include,
        // Real PostgreSQL fixtures share one isolated database. Serializing
        // files avoids cross-file Prisma interactive-transaction deadlocks;
        // concurrency within each test remains covered explicitly.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 30_000,
      },
    }),
  );
}

export default defineConfig(() => createIntegrationConfig());
