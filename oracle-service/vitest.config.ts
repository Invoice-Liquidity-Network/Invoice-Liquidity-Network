import { defineConfig } from 'vitest/config';

/**
 * Package-local vitest config for oracle-service.
 *
 * The root config sets an 80% threshold for the monorepo. This service gates
 * `fund_invoice()`'s `require_oracle_verification` path, so a verification bug
 * here releases funds against an invoice that should have been rejected. It is
 * held to 95%, matching the rigour applied to the insurance pool contract.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Test scaffolding, not shipped code — counting it would inflate the
        // figure the gate is meant to protect.
        'src/testFixtures.ts',
        'src/chaosUpstream.ts',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
