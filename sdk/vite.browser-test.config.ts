import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev server for SDK Freighter browser tests.
 * Aliases `@stellar/freighter-api` to a realistic extension mock so
 * `createFreighterSigner` exercises its real dynamic-import path in Chromium.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'tests/browser'),
  resolve: {
    alias: {
      '@stellar/freighter-api': path.resolve(__dirname, 'tests/browser/freighter-api-mock.ts'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['@stellar/freighter-api'],
  },
});
