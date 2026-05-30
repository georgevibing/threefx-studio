import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@threefx/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@threefx/runtime": fileURLToPath(new URL("./packages/runtime/src/index.ts", import.meta.url)),
      "@threefx/effects": fileURLToPath(new URL("./packages/effects/src/index.ts", import.meta.url)),
      "@threefx/exporter": fileURLToPath(new URL("./packages/exporter/src/index.ts", import.meta.url)),
      "@threefx/ui": fileURLToPath(new URL("./packages/ui/src/index.ts", import.meta.url)),
    },
  },
  test: {
    globals: false,
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
