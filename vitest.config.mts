import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'examples', 'tests/fixtures'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 70, // Measured branch coverage is 73.12%; retain a 70% regression floor.
        statements: 85,
      },
    },
  },
});
