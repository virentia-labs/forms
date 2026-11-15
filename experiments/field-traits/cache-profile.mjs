// Diagnostic only: run with --trace-turbo-inlining --print-bytecode
// --print-bytecode-filter=readForProxy; do not mix with timing controls.
import { scope, scoped, owner } from "@virentia/core";
const { createField } = await import(`./build/${process.argv[2] ?? "candidate"}.mjs`);
const app = scope();
const model = owner(() => ({ fields: Array.from({ length: 100 }, (_, n) => createField(n, { meta: { index: n } })) }));
function read() {
  let sum = 0;
  for (const field of model.fields) {
    sum += field.state.value + Number(field.isFocused.value) + Number(field.isValid.value);
    sum += Number(field.isValidationPending.value) + Number(field.innerError.value !== null);
    sum += Number(field.outerError.value !== null) + Number(field.error.value !== null);
    sum += field.meta.value.index;
  }
  return sum;
}
let sum = 0;
scoped(app, () => { for (let n = 0; n < 2000; n++) sum += read(); });
model.dispose();
console.log(sum);
