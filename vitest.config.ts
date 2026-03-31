import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    passWithNoTests: true,  // Vitest 4 exits 1 with no test files by default — safe to add, ignored once Phase 3 creates test files
    fileParallelism: false,
  },
});
