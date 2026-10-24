import { defineConfig } from 'vitest/config';

// The shared package's own tests, for Stryker (stryker.config.mjs)
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/shared/test/**/*.test.ts'],
  },
});
