// Diagnostic cached-read isolation. Complete phase acceptance uses core-rounds.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Session } from "node:inspector";

const root = path.dirname(fileURLToPath(import.meta.url));
const [coreArg, output, kind = "timing", sizeArg = "500", passesArg = "200"] = process.argv.slice(2);
const core = path.resolve(coreArg), size = Number(sizeArg), passes = Number(passesArg);
assert.ok(["timing", "cpu"].includes(kind));
const { scope, scoped } = await import(pathToFileURL(path.join(core, "dist/index.mjs")));
let bundle = await readFile(path.join(root, "build/model.mjs"), "utf8");
for (const [specifier, entry] of [["@virentia/core", "index"], ["@virentia/core/internal", "internal"], ["@virentia/core/models", "models"]])
  bundle = bundle.replaceAll(JSON.stringify(specifier), JSON.stringify(path.join(core, "dist", `${entry}.mjs`)));
const modulePath = path.join(root, "build/read-control.mjs");
await writeFile(modulePath, bundle);
const { declare } = await import(pathToFileURL(modulePath));

function read(rows) {
  let sum = 0;
  for (const { field, form } of rows) {
    sum += field.state.value + field.meta.value.index + Number(field.isFocused.value) + Number(field.isValid.value);
    sum += Number(field.isValidationPending.value) + Number(field.error.value !== null);
    sum += form.values.value.count + form.snapshot.value.count + Number(form.isChanged.value) + Number(form.isValid.value);
  }
  return sum;
}
function capture(rows) {
  return rows.map(({ field, form }) => [field.state, field.meta, field.isFocused, field.isValid,
    field.isValidationPending, field.error, form.values, form.snapshot, form.isChanged, form.isValid]);
}
function capturedRead(rows) {
  let sum = 0;
  for (const [state, meta, focused, valid, pending, error, values, snapshot, changed, formValid] of rows) {
    sum += state.value + meta.value.index + Number(focused.value) + Number(valid.value);
    sum += Number(pending.value) + Number(error.value !== null);
    sum += values.value.count + snapshot.value.count + Number(changed.value) + Number(formValid.value);
  }
  return sum;
}
const run = (app, rows, count, fn) => scoped(app, () => {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += fn(rows);
  return sum;
});
for (let i = 0; i < 3; i++) {
  const app = scope(), d = declare(() => null), owned = scoped(app, () => d.create(100));
  assert.equal(run(app, owned.rows, 20, read), 4000);
  await owned.dispose();
}
const app = scope();
let start = performance.now();
const d = declare(() => null);
const declaration = performance.now() - start;
start = performance.now();
const owned = scoped(app, () => d.create(size));
const create = performance.now() - start;
start = performance.now();
assert.equal(run(app, owned.rows, 1, read), size * 2);
const firstRead = performance.now() - start;
let session, post;
if (kind === "cpu") {
  session = new Session(); session.connect();
  post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, value) => error ? reject(error) : resolve(value)));
  await post("Profiler.enable"); await post("Profiler.setSamplingInterval", { interval: 100 }); await post("Profiler.start");
}
if (globalThis.__virentiaReadCounts) globalThis.__virentiaReadCounts = {};
start = performance.now();
assert.equal(run(app, owned.rows, passes, read), size * 2 * passes);
const cachedRead = performance.now() - start;
const counters = globalThis.__virentiaReadCounts && { ...globalThis.__virentiaReadCounts };
if (session) {
  const { profile } = await post("Profiler.stop"); session.disconnect();
  await writeFile(`${output}.cpuprofile`, JSON.stringify(profile));
}
// Secondary diagnostic deliberately removes namespace lookup; never substituted
// for the full public access path in acceptance timings.
const captured = scoped(app, () => capture(owned.rows));
assert.equal(run(app, captured, 20, capturedRead), size * 40);
start = performance.now();
assert.equal(run(app, captured, passes, capturedRead), size * 2 * passes);
const capturedCachedRead = performance.now() - start;
start = performance.now(); await owned.dispose();
const dispose = performance.now() - start;
const result = { core, kind, size, passes, times: { declaration, create, firstRead, cachedRead, capturedCachedRead, dispose }, counters };
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
