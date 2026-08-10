import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'runner/tests/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'lib/**'],
    testTimeout: 30_000,
  },
});
