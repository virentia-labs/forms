import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@virentia/forms/models", replacement: fileURLToPath(new URL("../forms/lib/models.ts", import.meta.url)) },
      { find: "@virentia/forms", replacement: fileURLToPath(new URL("../forms/lib/index.ts", import.meta.url)) },
    ],
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
