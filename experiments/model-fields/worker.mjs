import assert from "node:assert/strict";
import { performance, PerformanceObserver } from "node:perf_hooks";
import { scope, scoped } from "@virentia/core";
import { withUnitDeclarationTracker } from "@virentia/core/internal";

const mode = process.argv[2], round = Number(process.argv[3]), size = Number(process.argv[4] ?? 500);
const names = mode === "legacy" ? ["before", "after"] : ["dynamic", "model"];
const only = process.argv[5];
const moduleOverride = process.argv[6] || undefined;
if (only && !names.includes(only)) throw new Error("Unknown participant");
if (moduleOverride && !["before", "after", "original", "retained", "model", "model-core-control", "native-core-control"].includes(moduleOverride)) throw new Error("Unknown control module");
const order = only ? [only] : round % 2 ? [...names].reverse() : names;
const modules = {};
const gcEntries = [];
const observer = new PerformanceObserver(list => { gcEntries.push(...list.getEntries()); });
observer.observe({ entryTypes: ["gc"] });
for (const name of order) modules[name] = await import(`./build/${moduleOverride ?? name}.mjs`);
const gc = async () => { await new Promise(resolve => setImmediate(resolve)); for (let n = 0; n < 3; n++) global.gc(); };
const counts = fn => {
  const values = {};
  const result = withUnitDeclarationTracker(kind => { values[kind] = (values[kind] ?? 0) + 1; }, fn);
  return { values, result };
};
const read = rows => {
  let sum = 0;
  for (const { field, form } of rows) {
    sum += field.state.value + field.meta.value.index + Number(field.isFocused.value) + Number(field.isValid.value);
    sum += Number(field.isValidationPending.value) + Number(field.error.value !== null);
    sum += form.values.value.count + form.snapshot.value.count + Number(form.isChanged.value) + Number(form.isValid.value);
  }
  return sum;
};
async function exercise(name, size, track) {
  const app = scope(), times = {}, ranges = {};
  const record = (key, start) => { const end = performance.now(); times[key] = end - start; ranges[key] = [start, end]; };
  let validators = 0, updates = 0;
  const validate = value => { validators++; return value % 2 ? "Odd" : null; };
  let start = performance.now();
  let definition = track ? counts(() => modules[name].declare(validate)) : { result: modules[name].declare(validate) };
  record("declare", start);
  const initialSetups = definition.result.setups;
  start = performance.now();
  let created = track ? counts(() => scoped(app, () => definition.result.create(size))) : { result: scoped(app, () => definition.result.create(size)) };
  record("create", start);
  let owned = created.result, rows = owned.rows;
  start = performance.now();
  assert.equal(scoped(app, () => read(rows)), size * 2);
  record("firstRead", start);
  start = performance.now();
  let sum = 0;
  scoped(app, () => { for (let n = 0; n < 20; n++) sum += read(rows); });
  record("cachedRead", start);
  assert.equal(sum, size * 40);
  let unsubscribe = rows.map(row => row.field.state.subscribe(() => { updates++; }));
  start = performance.now();
  for (const { field } of rows) await scoped(app, () => field.fill(2));
  record("update", start);
  assert.equal(updates, size);
  assert.ok(scoped(app, () => rows.every(row => row.form.values.value.count === 2)));
  start = performance.now();
  for (const { field } of rows) await scoped(app, () => field.focus());
  record("dispatch", start);
  for (const phase of ["firstValidation", "repeatValidation"]) {
    start = performance.now();
    for (const { field } of rows) await scoped(app, () => field.validate());
    record(phase, start);
  }
  start = performance.now();
  for (const { form } of rows) await scoped(app, () => form.validate());
  record("formValidation", start);
  assert.equal(validators, size * 3);
  start = performance.now();
  for (const { form } of rows) await scoped(app, () => form.fill({ values: { count: 4 } }));
  record("formFill", start);
  assert.ok(scoped(app, () => rows.every(row => row.form.values.value.count === 4)));
  start = performance.now();
  for (const { form } of rows) await scoped(app, () => form.reset());
  record("reset", start);
  assert.equal(scoped(app, () => read(rows)), size * 2);
  start = performance.now();
  for (const stop of unsubscribe) stop();
  await owned.dispose();
  record("dispose", start);
  const declarations = track ? { definition: definition.values, instances: created.values } : undefined;
  return { times, declarations, ranges, checks: { validators, updates, size,
    setupRuns: initialSetups === undefined ? undefined : { declaration: initialSetups, instances: definition.result.setups - initialSetups } } };
}
async function memory(name, count) {
  await gc();
  const before = process.memoryUsage().heapUsed, app = scope();
  let definition = modules[name].declare(() => null);
  let owned = scoped(app, () => definition.create(count));
  await gc();
  const created = process.memoryUsage().heapUsed - before;
  scoped(app, () => read(owned.rows));
  await gc();
  const readHeap = process.memoryUsage().heapUsed - before;
  await owned.dispose();
  definition = undefined; owned = undefined;
  return { before, created, read: readHeap };
}
for (let n = 0; n < 3; n++) for (const name of order) await exercise(name, 100, false);
const samples = {};
for (const name of order) {
  await gc();
  const preflight = await exercise(name, 1, true);
  await gc();
  samples[name] = await exercise(name, size, false);
  samples[name].declarations = preflight.declarations;
  if (name === "dynamic") samples[name].declarations = {
    ...preflight.declarations, instances: null,
    note: "Core mutes declaration trackers during dynamic setup; setupRuns measures those calls independently",
  };
  const result = await memory(name, size);
  await gc();
  samples[name].memory = { created: result.created, read: result.read, released: process.memoryUsage().heapUsed - result.before };
  samples[name].gc = Object.fromEntries(Object.entries(samples[name].ranges).map(([key, [from, to]]) => [key,
    gcEntries.filter(entry => entry.startTime >= from && entry.startTime < to).reduce((total, entry) => total + entry.duration, 0)]));
  delete samples[name].ranges;
}
if (samples.model) assert.deepEqual(samples.model.declarations.instances, {});
console.log(JSON.stringify({ round, size, mode, order, node: process.version, samples }));
