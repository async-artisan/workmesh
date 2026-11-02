import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // API 编译为 CommonJS，必须同时产出 CJS；只给 ESM 会让 require() 以
  // ERR_PACKAGE_PATH_NOT_EXPORTED 在启动时直接崩掉。
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
