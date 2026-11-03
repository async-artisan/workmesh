import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  target: 'node20',
  clean: true,
  sourcemap: true,
  noExternal: ['@workmesh/shared', 'commander'],
  banner: {
    js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);",
  },
});
