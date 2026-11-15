// Diagnostic passes are separate from timing: inspector/async_hooks alter cost.
import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { Session } from "node:inspector/promises";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { scope, scoped } from "@virentia/core";

const [participant, phase, kind, output, count = "500", repeat = "20"] = process.argv.slice(2);
assert.ok(["original", "retained", "before", "after"].includes(participant));
assert.ok(["field", "form"].includes(phase));
assert.ok(["cpu", "counts", "timing"].includes(kind));
const size = Number(count), passes = Number(repeat);
const root = path.dirname(fileURLToPath(import.meta.url));
const module = await import(`./build/${participant}.mjs`);
await mkdir(path.dirname(output), { recursive: true });

function read(rows) {
  let sum = 0;
  for (const { field, form } of rows) {
    sum += field.state.value + field.meta.value.index + Number(field.isFocused.value) + Number(field.isValid.value);
    sum += Number(field.isValidationPending.value) + Number(field.error.value !== null);
    sum += form.values.value.count + form.snapshot.value.count + Number(form.isChanged.value) + Number(form.isValid.value);
  }
  return sum;
}
async function prepare(n) {
  const app = scope();
  let validators = 0, updates = 0;
  const definition = module.declare(value => { validators++; return value % 2 ? "Odd" : null; });
  const owned = scoped(app, () => definition.create(n));
  const { rows } = owned;
  assert.equal(scoped(app, () => read(rows)), n * 2);
  scoped(app, () => { for (let i = 0; i < 20; i++) read(rows); });
  const stops = rows.map(row => row.field.state.subscribe(() => { updates++; }));
  for (const { field } of rows) await scoped(app, () => field.fill(2));
  assert.equal(updates, n);
  for (const { field } of rows) await scoped(app, () => field.focus());
  for (const { field } of rows) await scoped(app, () => field.validate());
  return { app, rows, get validators() { return validators; }, async dispose() {
    for (const stop of stops) stop();
    await owned.dispose();
  } };
}
for (let i = 0; i < 3; i++) {
  const warm = await prepare(100);
  for (const { field } of warm.rows) await scoped(warm.app, () => field.validate());
  for (const { form } of warm.rows) await scoped(warm.app, () => form.validate());
  for (const { form } of warm.rows) await scoped(warm.app, () => form.fill({ values: { count: 4 } }));
  for (const { form } of warm.rows) await scoped(warm.app, () => form.reset());
  await warm.dispose();
}
const test = await prepare(size);
if (phase === "form") for (const { field } of test.rows) await scoped(test.app, () => field.validate());
await new Promise(resolve => setImmediate(resolve));
for (let i = 0; i < 3; i++) global.gc();
const initialValidators = test.validators;
const resources = {}, nodes = {};
let session, stopObserver, hook;
if (kind === "cpu") {
  session = new Session(); session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.setSamplingInterval", { interval: 100 });
  await session.post("Profiler.start");
} else if (kind === "counts") {
  // Resolve the actual shared chunk, rather than bundling a second Core singleton.
  const dist = path.dirname(fileURLToPath(import.meta.resolve("@virentia/core")));
  for (const name of await readdir(dist)) if (name.endsWith(".mjs")) {
    const code = await readFile(path.join(dist, name), "utf8");
    const match = code.match(/onInspectorEvent as ([\w$]+)/);
    if (!match) continue;
    const kernel = await import(pathToFileURL(path.join(dist, name)).href);
    stopObserver = kernel[match[1]](event => {
      if (event.type !== "node-end") return;
      const meta = event.node.meta?.["virentia.inspector"] ?? {};
      const key = `${meta.type ?? "node"}:${meta.name ?? "anonymous"}`;
      nodes[key] = (nodes[key] ?? 0) + 1;
    });
    break;
  }
  assert.ok(stopObserver, "Shared inspector export must be found");
  hook = createHook({ init(_id, type) { resources[type] = (resources[type] ?? 0) + 1; } });
  hook.enable();
}
const times = [];
for (let i = 0; i < passes; i++) {
  const start = performance.now();
  for (const row of test.rows) await scoped(test.app, () => row[phase].validate());
  times.push(performance.now() - start);
}
hook?.disable(); stopObserver?.();
if (session) {
  const { profile } = await session.post("Profiler.stop");
  session.disconnect();
  await writeFile(`${output}.cpuprofile`, JSON.stringify(profile));
}
assert.equal(test.validators - initialValidators, size * passes);
assert.ok(scoped(test.app, () => test.rows.every(row => row.field.state.value === 2 && row.form.values.value.count === 2 && !row.field.isValidationPending.value)));
await test.dispose();
const result = { participant, phase, kind, size, passes, operations: size * passes, times,
  validators: test.validators - initialValidators, resources, nodes };
await writeFile(`${output}.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ participant, phase, kind, operations: result.operations, resources,
  nodeRuns: Object.values(nodes).reduce((sum, n) => sum + n, 0), totalMs: times.reduce((sum, n) => sum + n, 0) }));
