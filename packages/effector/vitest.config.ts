import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // `@virentia/effector`'s source resolves `@virentia/core` (and its
    // `/internal` `run` primitive) from its own monorepo — a different install,
    // hence a second kernel instance whose scopes/associations would never match
    // the ones created in these tests. Pin the bare specifier AND the `/internal`
    // subpath (exact matches, so other subpaths still resolve normally) to the
    // single hoisted install, so forms, the bridge, and `@virentia/effector` all
    // share one kernel.
    alias: [
      {
        find: "@virentia/forms",
        replacement: fileURLToPath(new URL("../forms/lib/index.ts", import.meta.url)),
      },
      {
        find: "@virentia/effector",
        replacement: fileURLToPath(
          new URL("../../../virentia/packages/effector/lib/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@virentia\/core$/,
        replacement: fileURLToPath(
          new URL("../../node_modules/@virentia/core/dist/index.mjs", import.meta.url),
        ),
      },
      {
        find: /^@virentia\/core\/internal$/,
        replacement: fileURLToPath(
          new URL("../../node_modules/@virentia/core/dist/internal.mjs", import.meta.url),
        ),
      },
    ],
  },
  test: {
    cache: false,
    singleThread: true,
    include: ["tests/**/*.test.ts"],
  },
});
