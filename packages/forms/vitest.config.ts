import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    cache: false,
    singleThread: true,
    include: ["tests/**/*.test.ts"],
  },
});
