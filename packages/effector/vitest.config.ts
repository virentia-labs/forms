import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@virentia/forms",
        replacement: fileURLToPath(
          new URL("../forms/lib/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@virentia\/core$/,
        replacement: fileURLToPath(
          new URL(
            "../../node_modules/@virentia/core/dist/index.mjs",
            import.meta.url,
          ),
        ),
      },
      {
        find: /^@virentia\/core\/internal$/,
        replacement: fileURLToPath(
          new URL(
            "../../node_modules/@virentia/core/dist/internal.mjs",
            import.meta.url,
          ),
        ),
      },
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
