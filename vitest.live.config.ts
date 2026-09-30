import { defineConfig } from 'vitest/config';

/**
 * The live API lane. Not part of `npm test`: it needs a running stack, a real
 * account and a model, and it spends a few model calls. Run it with
 * `npm run test:live-api`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/live/**/*.live.test.ts'],
    fileParallelism: false,
    // The dev stack is signed by a local CA the system trusts and Node does not.
    execArgv: ['--use-system-ca'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
