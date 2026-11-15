import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { scope, scoped } from "@virentia/core";
const name = process.argv[2], count = Number(process.argv[3] ?? 500);
const { declare } = await import(`./build/${name}.mjs`);
async function exercise(count, rounds) {
  const app = scope(), owned = scoped(app, () => declare(() => null).create(count));
  const stops = [];
  scoped(app, () => {
    for (const { field, form } of owned.rows) {
      void field.state.value; void field.meta.value; void field.error.value; void field.isValid.value;
      void field.isFocused.value; void field.isValidationPending.value;
      void form.values.value; void form.snapshot.value; void form.isChanged.value; void form.isValid.value;
      stops.push(field.state.subscribe(() => {}));
    }
  });
  for (const { field } of owned.rows) await scoped(app, () => field.fill(2));
  const ms = [];
  for (let n = 0; n < rounds; n++) {
    for (const { field } of owned.rows) await scoped(app, () => field.blur());
    const start = performance.now();
    for (const { field } of owned.rows) await scoped(app, () => field.focus());
    ms.push(performance.now() - start);
    assert.ok(scoped(app, () => owned.rows.every(row => row.field.isFocused.value)));
  }
  for (const stop of stops) stop();
  await owned.dispose();
  return ms;
}
await exercise(100, 20);
await new Promise(resolve => setImmediate(resolve));
global.gc();
const times = await exercise(count, 20);
const sorted = [...times].sort((a, b) => a - b);
console.log(JSON.stringify({ name, count, times, median: sorted[10], total: times.reduce((sum, ms) => sum + ms, 0), node: process.version }));
