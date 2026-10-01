import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Freighter wallet-extension interaction tests.
 * Serves the real `createFreighterSigner` path via Vite with a realistic
 * Freighter API mock (see tests/browser/README.md).
 */
export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite --config vite.browser-test.config.ts --port 5174',
    port: 5174,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
