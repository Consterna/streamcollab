import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', 'packages/**/*.browser.test.tsx'],
        },
      },
      {
        // React components in a real Chromium (the browser Playwright already installs for the E2E run)
        plugins: [react()],
        test: {
          name: 'browser',
          include: ['packages/client/test/**/*.browser.test.tsx'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      // Every source file counts, including the ones no test loads yet
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['packages/client/src/main.tsx', '**/*.d.ts'],
      // Measured with both projects (npm run test:coverage) for v1.6.2: 66.4 / 57.1 / 55.8 / 68.4 %.
      // The run fails if coverage drops below; raise these as tests are added.
      thresholds: { statements: 66, branches: 57, functions: 55, lines: 68 },
    },
  },
});
