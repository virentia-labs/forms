import { performance } from "node:perf_hooks";
const variant = process.argv[2];
if (!["baseline", "candidate"].includes(variant)) throw new Error("Invalid variant");
const start = performance.now();
const { createField } = await import(`./build/${variant}.mjs`);
const imported = performance.now();
const field = createField(0);
const created = performance.now();
const { scope, scoped } = await import("@virentia/core");
const app = scope();
const readStart = performance.now();
const value = scoped(app, () => field.state.value);
const end = performance.now();
if (value !== 0) throw new Error("Wrong initial value");
console.log(JSON.stringify({ variant, importMs: imported - start, createMs: created - imported,
  firstReadMs: end - readStart, readyMs: end - start }));
