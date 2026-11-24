import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const vite = createRequire(require.resolve("vitest")).resolve("vite");
const { build } = require(createRequire(vite).resolve("esbuild"));
const root = path.dirname(fileURLToPath(import.meta.url));
const current = path.resolve(root, "../../packages/forms/lib/index.ts");
const baseline = path.resolve(process.argv[2], "forms/packages/forms/lib/index.ts");
for (const name of ["before", "after", "dynamic", "model", "field-baseline", "field-candidate"]) {
  await build({ entryPoints: [path.join(root, name.startsWith("field-") ? "native-field.ts" : name === "model" || name === "dynamic" ? "model.ts" : "native.ts")],
    outfile: path.join(root, "build", `${name}.mjs`), bundle: true, format: "esm", platform: "node", target: "node24",
    alias: { "forms-under-test": name === "before" || name === "field-baseline" ? baseline : current },
    external: ["@virentia/core", "@virentia/core/*"],
    plugins: name === "dynamic" ? [{ name: "per-instance-graph", setup(build) {
      build.onResolve({ filter: /^@virentia\/core\/models$/ }, args => args.namespace === "dynamic-wrapper"
        ? { external: true, path: args.path } : { namespace: "dynamic-wrapper", path: args.path });
      build.onLoad({ filter: /.*/, namespace: "dynamic-wrapper" }, () => ({
        contents: 'export * from "@virentia/core/models"; export { model as staticModel } from "@virentia/core/models";', loader: "js",
      }));
    } }] : [],
  });
}
