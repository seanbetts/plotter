import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['server/**/*.test.ts', 'tests/**/*.unit.test.ts'],
  },
});
