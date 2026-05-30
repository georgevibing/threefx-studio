import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@threefx/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@threefx/runtime": fileURLToPath(new URL("../../packages/runtime/src/index.ts", import.meta.url)),
      "@threefx/effects": fileURLToPath(new URL("../../packages/effects/src/index.ts", import.meta.url)),
      "@threefx/exporter": fileURLToPath(new URL("../../packages/exporter/src/index.ts", import.meta.url)),
      "@threefx/ui": fileURLToPath(new URL("../../packages/ui/src/index.ts", import.meta.url)),
    },
  },
});
