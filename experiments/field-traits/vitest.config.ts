import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import forms from "../../packages/forms/vitest.config";
import react from "../../packages/forms-react/vitest.config";
import zod from "../../packages/forms-zod/vitest.config";
import effector from "../../packages/effector/vitest.config";

const original = fileURLToPath(new URL("../../packages/forms/lib/field.ts", import.meta.url));
const candidate = fileURLToPath(new URL("./field.ts", import.meta.url));

const bases = { forms, "forms-react": react, "forms-zod": zod, effector,
  ecosystem: { test: { environment: "happy-dom", include: ["tests/**/*.test.ts"] } } };
const base = bases[path.basename(process.cwd()) as keyof typeof bases];
if (!base) throw new Error("Run from a Forms package or the ecosystem fixture");

export default defineConfig(mergeConfig(base, {
  plugins: [{
    name: "field-traits-prototype",
    enforce: "pre",
    resolveId(source: string, importer?: string) {
      if (!importer || !source.startsWith(".")) return;
      const resolved = path.resolve(path.dirname(importer.split("?")[0]), source);
      if (resolved === original || resolved + ".ts" === original) return candidate;
    },
  }],
  resolve: { alias: { "@virentia/forms": fileURLToPath(new URL("../../packages/forms/lib/index.ts", import.meta.url)) } },
  test: { cache: false, threads: false },
}));
