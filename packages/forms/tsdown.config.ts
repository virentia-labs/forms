import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["lib/index.ts", "lib/models.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  // Scalar fields do not need schema-traversal effects or collection factories.
  unbundle: true,
  outputOptions(options, format) {
    if (format === "cjs") options.preserveModules = false;
  },
  dts: true,
  clean: true,
  external: ["@virentia/core"],
});
