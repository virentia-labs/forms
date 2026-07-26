import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@virentia/forms": fileURLToPath(
        new URL("../forms/lib/index.ts", import.meta.url),
      ),
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
