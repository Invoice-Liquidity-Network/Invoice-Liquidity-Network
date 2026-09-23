import { mergeConfig } from 'vitest/config';
import base from '../vitest.config';
import { resolve } from 'path';

export default mergeConfig(base, {
  resolve: {
    alias: {
      '@iln/sdk': resolve(__dirname, '../sdk/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
