import { children, staticModel } from "@virentia/core/models";
import { createForm } from "../../packages/forms/lib";
import { fieldModel } from "../../packages/forms/lib/models";

export function declare(validate: (value: number) => string | null) {
  let setups = 0;
  const Count = fieldModel(0, { validate, meta: { index: 0 } });
  const Row = staticModel({
    data: { count: children.one(Count) },
    setup(self) { setups++; return { form: createForm({ schema: () => ({ count: self.count.value!.field }) }) }; },
    onCreate(self) { self.count.create({}); },
  });
  return {
    get setups() { return setups; },
    create(count: number) {
      const instances = Row.create(Array.from({ length: count }, () => ({})));
      const rows = instances.map(instance => ({ field: instance.count.value!.field, form: instance.form }));
      return { rows, async dispose() { for (const instance of instances) await instance.dispose(); } };
    },
  };
}
