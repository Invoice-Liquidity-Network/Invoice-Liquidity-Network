import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
  build: {
    lib: {
      entry: 'src/index.browser.ts',
      formats: ['es'],
      fileName: 'index',
    },
    outDir: 'dist/browser',
    target: 'es2022',
    rollupOptions: {
      // Optional peer: the wallet integration loads it on demand, and the host
      // app provides it, so it must not be inlined into the SDK bundle.
      external: ['@stellar/freighter-api'],
    },
  },
  resolve: {
    conditions: ['browser'],
  },
  // The browser tests serve their own ESM Freighter mock for this import.
  // Pre-bundling would wrap the CommonJS package in an interop shim that
  // drops the mock's named exports.
  optimizeDeps: {
    exclude: ['@stellar/freighter-api'],
  },
});
