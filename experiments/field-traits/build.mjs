import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const vite = createRequire(require.resolve("vitest")).resolve("vite");
const { build } = require(createRequire(vite).resolve("esbuild"));
const root = path.dirname(fileURLToPath(import.meta.url));
for (const [name, entry] of [["baseline", "./baseline.ts"], ["candidate", "./field.ts"]]) {
  await build({
    entryPoints: [path.resolve(root, entry)], outfile: path.join(root, "build", `${name}.mjs`),
    bundle: true, format: "esm", platform: "node", target: "node24",
    external: ["@virentia/core", "@virentia/core/*"],
  });
}
console.log("Built frozen baseline and native trait prototype");
