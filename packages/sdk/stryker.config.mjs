// @ts-check
/**
 * Stryker mutation testing configuration for the @iln/sdk package.
 *
 * Target: packages/sdk/src/errors.ts — a high-value, self-contained module
 * with comprehensive test coverage for structured error types, contract error
 * parsing, and error normalization utilities.
 *
 * Why this target:
 * - errors.ts exports 20+ error classes + 2 utility functions
 * - errors.test.ts has 35+ test cases covering all error types
 * - No external dependencies (pure TypeScript logic)
 * - Fast to mutate and test (< 30s on CI)
 * - If mutations survive here, they reveal real gaps in test quality
 *
 * Target mutation score: ≥ 80% (lines / statements).
 *
 * @see docs/mutation-testing.md for project-wide mutation testing strategy.
 */
const config = {
  // Use the package's existing Jest configuration
  testRunner: 'jest',
  mutate: ['src/errors.ts'],
  jest: {
    config: {
      testMatch: ['**/src/errors.test.ts'],
    },
    projectType: 'custom',
    enableFindRelatedTests: true,
  },
  // Reporters
  reporters: ['html', 'clear-text', 'progress'],
  // Fail CI if score drops below threshold
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  // Optional: limit concurrent mutants to avoid OOM on CI runners
  maxConcurrentTestRunners: 2,
  // Allow 5 minutes for the full mutation run
  timeoutMS: 300000,
  // Exclude trivial mutations that tend to be noise (string literals, etc.)
  mutator: {
    excludedMutations: ['StringLiteral'],
  },
  // HTML report output
  htmlReporter: {
    baseDir: 'reports/mutation',
  },
};

export default config;
