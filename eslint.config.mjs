// ESLint 10 flat config for the whole monorepo
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/coverage/**', 'test-results/**', 'playwright-report/**']),

  js.configs.recommended,
  tseslint.configs.recommended,

  // Node: server, shared library, tests and tooling config
  {
    files: ['packages/server/**/*.ts', 'packages/shared/**/*.ts', '*.ts', '*.mjs'],
    languageOptions: { globals: globals.node },
  },

  // Browser: React client (hooks rules incl. the React Compiler checks)
  {
    files: ['packages/client/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },

  {
    rules: {
      // Application code is fully typed; `any` is only tolerated in test files (below)
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  {
    files: ['packages/*/test/**/*.ts', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // Formatting is Prettier's job: turn off stylistic rules that would conflict
  prettier,
]);
