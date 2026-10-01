import { mergeConfig } from 'vitest/config';
import base from '../vitest.config';

export default mergeConfig(base, {
  resolve: {
    // Force a single graphql instance to avoid "different realm" errors
    // when @graphql-tools and graphql-subscriptions are both in the tree.
    dedupe: ['graphql'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
