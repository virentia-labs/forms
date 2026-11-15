import assert from "node:assert/strict";
import { owner, scope, scoped, store } from "@virentia/core";
import { setUnitDeclarationTracker } from "@virentia/core/internal";
const factories = {}, report = {};
let counts;
const previous = setUnitDeclarationTracker(kind => { counts[kind] = (counts[kind] ?? 0) + 1; });
try {
  for (const name of ["baseline", "candidate"]) {
    const result = report[name] = {};
    counts = result.import = {};
    factories[name] = (await import(`./build/${name}.mjs`)).createField;
    const app = scope(), dependency = store(0);
    let calls = 0, owned;
    counts = result.create = {};
    owned = owner(() => ({ field: factories[name](0, { validate(value, ctx) {
      calls++; return value === ctx.read(dependency) ? null : "Mismatch";
    } }) }));
    const field = owned.field;
    const read = () => [field.state.value, field.meta.value, field.error.value, field.innerError.value,
      field.outerError.value, field.isValid.value, field.isFocused.value, field.isValidationPending.value];
    for (const label of ["firstRead", "cachedRead"]) {
      counts = result[label] = {}; scoped(app, read);
    }
    counts = result.update = {}; await scoped(app, () => field.fill(1));
    counts = result.dispatch = {}; await scoped(app, () => field.focus());
    counts = result.firstValidation = {}; await scoped(app, () => field.validate());
    counts = result.repeatValidation = {}; await scoped(app, () => field.validate());
    counts = result.reset = {}; await scoped(app, () => field.reset());
    counts = result.dispose = {}; owned.dispose();
    assert.equal(calls, 2);
  }
} finally { setUnitDeclarationTracker(previous); }
assert.deepEqual(report.candidate.import, report.baseline.import, "import");
for (const key of Object.keys(report.baseline).filter(key => key !== "import"))
  assert.deepEqual(report.baseline[key], report.candidate[key], key);
console.log(JSON.stringify(report, null, 2));
