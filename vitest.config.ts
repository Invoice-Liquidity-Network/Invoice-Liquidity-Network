import { resolve } from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@invoice-liquidity/sdk': resolve(__dirname, 'sdk/src/index.ts'),
      '@iln/sdk': resolve(__dirname, 'sdk/src/index.ts'),
      '@iln/oracle-service': resolve(__dirname, 'oracle-service/src/index.ts'),
      '@iln/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@iln/opentelemetry': resolve(__dirname, 'packages/opentelemetry/src/index.ts'),
    },
  },
  test: {
    // backend/ and frontend/ are git submodules with their own dependencies and
    // test runners; a root filter like tests/e2e/x.test.ts would otherwise also
    // match backend/tests/e2e/x.test.ts.
    exclude: [...configDefaults.exclude, 'backend/**', 'frontend/**'],
    environment: 'node',
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
