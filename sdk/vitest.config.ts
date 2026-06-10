import { mergeConfig } from "vitest/config";
import base from "../vitest.config";

export default mergeConfig(base, {
  test: {
    include: [
      "src/**/*.test.ts",
      "__tests__/**/*.test.ts",
      "tests/**/*.test.ts",
      "../packages/sdk/tests/**/*.test.ts",
    ],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 80,
        branches: 80,
      },
    },
  },
});
