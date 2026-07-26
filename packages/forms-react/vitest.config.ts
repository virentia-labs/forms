import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
    environment: "happy-dom",
    singleThread: true,
    include: ["tests/**/*.test.tsx"],
    typecheck: {
      include: ["tests/**/*.test-d.ts"],
    },
  },
});
