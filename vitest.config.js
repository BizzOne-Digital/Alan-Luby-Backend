import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Each file starts its own in-memory MongoDB; running files one at a time keeps memory use predictable.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough-1234567890',
      FRONTEND_URL: 'http://localhost:3000',
    },
  },
});
