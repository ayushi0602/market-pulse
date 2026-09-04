import { defineConfig } from 'vitest/config';

/**
 * Root test runner. Each package contributes a projects entry so that
 * `npm test` at the repo root runs every suite in one pass.
 */
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
  },
});
