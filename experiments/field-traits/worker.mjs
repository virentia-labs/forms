import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { scope, scoped, owner, store, getCurrentScope } from "@virentia/core";
import { withUnitDeclarationTracker } from "@virentia/core/internal";

const round = Number(process.argv[2] ?? 0), size = Number(process.argv[3] ?? 1000);
const only = process.argv[4];
if (only !== undefined && !["baseline", "candidate"].includes(only)) throw new Error("Invalid participant");
const order = only ? [only] : round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
const factories = {};
const imports = {};
for (const name of order) {
  const start = performance.now();
  // Import has its own phase; these counts include module-level declarations.
  const module = await import(`./build/${name}.mjs`);
  imports[name] = { ms: performance.now() - start };
  factories[name] = module.createField;
}
const gc = async () => {
  // Native diagnostics can hold WeakRefs until the current job ends. Merely
  // calling gc() in the same microtask chain overstates retained/released heap.
  await new Promise(resolve => setImmediate(resolve));
  for (let n = 0; n < 3; n++) global.gc();
};
const checksum = (fields) => {
  let sum = 0;
  for (const field of fields) {
    sum += field.state.value + Number(field.isFocused.value) + Number(field.isValid.value);
    sum += Number(field.isValidationPending.value) + Number(field.innerError.value !== null);
    sum += Number(field.outerError.value !== null) + Number(field.error.value !== null);
    sum += field.meta.value.index;
  }
  return sum;
};

async function exercise(createField, count, retainMemory) {
  await gc();
  const heapBefore = process.memoryUsage().heapUsed;
  let app = scope(), validatorCalls = 0, updates = 0;
  const dependency = store(0);
  const validate = (value, ctx) => {
    validatorCalls++;
    return value % 2 === ctx.read(dependency) % 2 ? null : "Mismatch";
  };
  let owned;
  const times = {};
  let start = performance.now();
  owned = owner(() => ({ fields: Array.from({ length: count }, (_, index) =>
    createField(index, { meta: { index }, validate })) }));
  times.create = performance.now() - start;
  await gc();
  const heapCreated = process.memoryUsage().heapUsed - heapBefore;

  start = performance.now();
  const initial = scoped(app, () => checksum(owned.fields));
  times.firstRead = performance.now() - start;
  assert.equal(initial, count * count);
  start = performance.now();
  let sum = 0;
  scoped(app, () => { for (let n = 0; n < 20; n++) sum += checksum(owned.fields); });
  times.cachedRead = performance.now() - start;
  assert.equal(sum, initial * 20);
  await gc();
  const heapRead = process.memoryUsage().heapUsed - heapBefore;

  scoped(app, () => { for (const field of owned.fields) field.state.subscribe(() => { updates++; }); });
  start = performance.now();
  for (const [index, field] of owned.fields.entries()) await scoped(app, () => field.fill(index + 1));
  times.update = performance.now() - start;
  assert.equal(updates, count);

  start = performance.now();
  for (const field of owned.fields) await scoped(app, () => field.focus());
  times.dispatch = performance.now() - start;
  assert.equal(scoped(app, () => owned.fields.filter(field => field.isFocused.value).length), count);

  start = performance.now();
  for (const field of owned.fields) await scoped(app, () => field.validate());
  times.firstValidation = performance.now() - start;
  assert.equal(validatorCalls, count);
  start = performance.now();
  for (const field of owned.fields) await scoped(app, () => field.validate());
  times.repeatValidation = performance.now() - start;
  assert.equal(validatorCalls, count * 2);

  start = performance.now();
  for (const field of owned.fields) await scoped(app, () => field.reset());
  times.reset = performance.now() - start;
  assert.equal(scoped(app, () => checksum(owned.fields)), initial);
  await gc();
  const heapActive = process.memoryUsage().heapUsed - heapBefore;

  start = performance.now();
  owned.dispose();
  times.dispose = performance.now() - start;
  owned = undefined; app = undefined;
  // Measure released heap in the caller: V8 may keep a completed for-of
  // iterator (and its whole fields array) in this async frame until it returns.
  return { heapBefore, times, memory: retainMemory ? { created: heapCreated, read: heapRead, active: heapActive } : undefined,
    checks: { count, validatorCalls, updates, initial } };
}

async function measured(createField, count) {
  const result = await exercise(createField, count, true);
  const start = performance.now();
  await gc();
  result.times.collect = performance.now() - start;
  result.memory.released = process.memoryUsage().heapUsed - result.heapBefore;
  delete result.heapBefore;
  return result;
}

const counts = {};
for (const name of order) {
  const countsForField = {};
  const owned = owner(() => ({ field: withUnitDeclarationTracker(kind => {
    countsForField[kind] = (countsForField[kind] ?? 0) + 1;
  }, () => factories[name](0)) }));
  counts[name] = countsForField;
  owned.dispose();
}
if (!only) assert.deepEqual(counts.candidate, counts.baseline);
else assert.deepEqual(counts[only], { store: 22, event: 54, reaction: 8 });
for (let warm = 0; warm < 2; warm++) for (const name of order) await exercise(factories[name], 50, false);
const samples = {};
for (const name of order) samples[name] = await measured(factories[name], size);
console.log(JSON.stringify({ round, size, order, node: process.version, counts, imports, samples }));
