import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The type suite imports the package by its own name. Without this alias
      // Vite resolves it through package.json exports to `dist/`, which does not
      // exist on a fresh checkout — CI runs `test` before `build`.
      "@virentia/forms": fileURLToPath(new URL("./lib/index.ts", import.meta.url)),
    },
  },
  test: {
    cache: false,
    singleThread: true,
    include: ["tests/**/*.test.ts"],
    typecheck: {
      include: ["tests/**/*.test-d.ts"],
    },
  },
});
