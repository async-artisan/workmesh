import { defineConfig } from 'tsup';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEsbuildEvidenceHooks } from '../../scripts/lib/bundle-evidence.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const evidence = createEsbuildEvidenceHooks({ packageDir, repoRoot: resolve(packageDir, '../..') });

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  target: 'node20',
  clean: true,
  sourcemap: true,
  ...evidence,
  noExternal: ['@workmesh/shared', 'commander'],
  banner: {
    js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);",
  },
});
