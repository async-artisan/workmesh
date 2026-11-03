import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // CLI 入口需要 shebang；打包后仍是可执行脚本。
  banner: { js: '#!/usr/bin/env node' },
});
