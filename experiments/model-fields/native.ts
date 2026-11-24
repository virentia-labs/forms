import { owner } from "@virentia/core";
import { createField, createForm } from "forms-under-test";

export function declare(validate: (value: number) => string | null) {
  return {
    create(count: number) {
      const roots = Array.from({ length: count }, () => owner(() => {
        const field = createField(0, { validate, meta: { index: 0 } });
        return { field, form: createForm({ schema: { count: field } }) };
      }));
      return { rows: roots, dispose() { for (const root of roots) root.dispose(); } };
    },
  };
}
