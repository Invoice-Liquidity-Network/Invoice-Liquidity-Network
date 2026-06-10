import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    alias: {
      "@iln/sdk": path.resolve(__dirname, "../../sdk/src/index.ts"),
    },
  },
});
