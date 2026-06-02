import { mergeConfig } from 'vitest/config';
import base from '../vitest.config';

export default mergeConfig(base, {
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
