import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '.tmp/**',
      '.runs/**',
      '.workbuddy/**',
    ],
  },
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
        fetch: 'readonly',
        AbortSignal: 'readonly',
        AbortController: 'readonly',
        Headers: 'readonly',
        Response: 'readonly',
        URLSearchParams: 'readonly',
        clearTimeout: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        // 仓库既有约定：以下划线前缀标记「有意保留但未使用」的参数与解构变量。
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
