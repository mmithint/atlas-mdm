import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the function modules (identity, profile). Plain Node, no database:
 * the SQL helpers are mocked. The specs are excluded from `tsc` (tsconfig.json), so they
 * never reach `dist/` and are never deployed.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
