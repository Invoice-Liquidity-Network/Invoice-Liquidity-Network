import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: process.env.SKIP_DTS !== "true",
    minify: true,
    sourcemap: true,
    clean: true,
    target: "es2020",
    external: ["react", "react-native", "@stellar/stellar-sdk"],
    outExtension({ format }) {
      return {
        js: format === "esm" ? ".mjs" : ".cjs",
      };
    },
  },
  {
    entry: ["src/react-native/index.ts"],
    format: ["esm"],
    dts: process.env.SKIP_DTS !== "true",
    minify: true,
    sourcemap: true,
    clean: true,
    target: "esnext",
    outDir: "dist/react-native",
    external: ["react", "react-native", "@stellar/stellar-sdk"],
    platform: "browser",
    outExtension() {
      return { js: ".js" };
    },
  },
]);
