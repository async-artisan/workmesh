import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 仓库里的 .mjs 都是 Node 脚本（构建、门禁、运维），需要 Node 全局量。
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
