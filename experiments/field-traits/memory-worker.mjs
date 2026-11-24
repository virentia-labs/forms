import assert from "node:assert/strict";
import { scope, scoped, owner, withOwner, store, getCurrentScope } from "@virentia/core";
const variant = process.argv[2], size = Number(process.argv[3] ?? 1000);
const gc = async () => {
  for (let n = 0; n < 3; n++) {
    await new Promise(resolve => setImmediate(resolve)); global.gc();
  }
};
await gc();
const beforeImport = process.memoryUsage().heapUsed;
const { createField } = await import(`./build/${variant}.mjs`);
await gc();
const afterImport = process.memoryUsage().heapUsed;
function createFixture() {
  const dependency = store(0);
  const validate = (value, ctx) => value % 2 === ctx.read(dependency) % 2 ? null : "Mismatch";
  const owned = owner((_dispose, ownerRef) => ({ ownerRef,
    fields: Array.from({ length: size }, (_, index) => createField(index, { meta: { index }, validate })),
  }));
  return { owned, app: scope() };
}
function read(fixture) {
  return scoped(fixture.app, () => {
    let sum = 0;
    for (const field of fixture.owned.fields) {
      sum += field.state.value + field.meta.value.index + Number(field.isValid.value);
      sum += Number(field.isFocused.value) + Number(field.isValidationPending.value);
      sum += Number(field.error.value !== null) + Number(field.innerError.value !== null) + Number(field.outerError.value !== null);
    }
    return sum;
  });
}
async function activate(fixture) {
  scoped(fixture.app, () => withOwner(fixture.owned.ownerRef, () => {
    for (const field of fixture.owned.fields) field.state.subscribe(() => {});
  }));
  for (const field of fixture.owned.fields) await scoped(fixture.app, () => field.validate());
}
let fixture = createFixture();
await gc();
const created = process.memoryUsage().heapUsed - afterImport;
assert.equal(read(fixture), size * size);
await gc();
const firstRead = process.memoryUsage().heapUsed - afterImport;
await activate(fixture);
await gc();
const active = process.memoryUsage().heapUsed - afterImport;
const api = new WeakRef(fixture.owned.fields[0]);
const node = new WeakRef(fixture.owned.fields[0].state.node);
fixture.owned.dispose(); fixture = undefined;
await gc();
const released = process.memoryUsage().heapUsed - afterImport;
console.log(JSON.stringify({ variant, size, module: afterImport - beforeImport, created, firstRead, active, released,
  apiCollected: api.deref() === undefined, nodeCollected: node.deref() === undefined, ambientScope: getCurrentScope() === null }));
