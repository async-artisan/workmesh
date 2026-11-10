import { defineConfig } from 'tsup';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEsbuildEvidenceHooks } from '../../scripts/lib/bundle-evidence.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const evidence = createEsbuildEvidenceHooks({ packageDir, repoRoot: resolve(packageDir, '../..') });

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  ...evidence,
  noExternal: ['ajv', 'ajv-formats'],
});
