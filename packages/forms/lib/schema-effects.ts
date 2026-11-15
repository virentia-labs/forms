import { effect } from "@virentia/core";
import { isFieldContract, isPlainObject, normalizeField, type AnyRecord } from "./shared";

// Schema traversal runs as per-call effects: the caller awaits one of these with
// a direct effect await, which restores the caller's scope on return. Recursion
// re-invokes the same effect (also a direct await).
export const fillSchemaFx = effect<{ schema: AnyRecord; values: AnyRecord }, void, Error>(
  async ({ schema, values }) => {
    for (const [key, value] of Object.entries(values)) {
      const fieldOrSchema = schema[key];

      if (!fieldOrSchema) {
        continue;
      }

      if (isFieldContract(fieldOrSchema)) {
        await normalizeField(fieldOrSchema).fill(value);
      } else {
        await fillSchemaFx({ schema: fieldOrSchema, values: value as AnyRecord });
      }
    }
  },
  "forms.fillSchema",
);

export const resetSchemaFx = effect<AnyRecord, void, Error>(async (schema) => {
  for (const fieldOrSchema of Object.values(schema)) {
    if (isFieldContract(fieldOrSchema)) {
      await normalizeField(fieldOrSchema).reset();
    } else {
      await resetSchemaFx(fieldOrSchema);
    }
  }
}, "forms.resetSchema");

export const validateSchemaFx = effect<AnyRecord, void, Error>(async (schema) => {
  for (const fieldOrSchema of Object.values(schema)) {
    if (isFieldContract(fieldOrSchema)) {
      await normalizeField(fieldOrSchema).validate();
    } else {
      await validateSchemaFx(fieldOrSchema);
    }
  }
}, "forms.validateSchema");

export const clearSchemaErrorsFx = effect<
  { schema: AnyRecord; channel: "inner" | "outer" },
  void,
  Error
>(async ({ schema, channel }) => {
  for (const fieldOrSchema of Object.values(schema)) {
    if (isFieldContract(fieldOrSchema)) {
      const field = normalizeField(fieldOrSchema);
      if (channel === "inner") {
        await field.clearInnerErrors();
      } else {
        await field.clearOuterErrors();
      }
    } else {
      await clearSchemaErrorsFx({ schema: fieldOrSchema, channel });
    }
  }
}, "forms.clearSchemaErrors");

export const applyErrorsToSchemaFx = effect<
  { schema: AnyRecord; errors: AnyRecord; channel: "inner" | "outer" },
  void,
  Error
>(async ({ schema, errors, channel }) => {
  const normalizedErrors = expandDottedPaths(errors);

  for (const [key, errorValue] of Object.entries(normalizedErrors)) {
    const fieldOrSchema = schema[key];

    if (!fieldOrSchema) {
      continue;
    }

    if (isFieldContract(fieldOrSchema)) {
      const field = normalizeField(fieldOrSchema);
      if (channel === "inner") {
        await field.setInnerErrors(errorValue);
      } else {
        await field.setOuterErrors(errorValue);
      }
    } else if (errorValue && typeof errorValue === "object") {
      await applyErrorsToSchemaFx({
        schema: fieldOrSchema,
        errors: errorValue as AnyRecord,
        channel,
      });
    }
  }
}, "forms.applyErrorsToSchema");

function expandDottedPaths(input: AnyRecord): AnyRecord {
  const result: AnyRecord = {};

  for (const [key, value] of Object.entries(input)) {
    if (key.includes(".")) {
      setNestedPath(result, key.split("."), value);
    } else {
      const nextValue = isPlainObject(value) ? expandDottedPaths(value) : value;
      const previousValue = result[key];

      result[key] =
        isPlainObject(previousValue) && isPlainObject(nextValue)
          ? mergePlainObjects(previousValue, nextValue)
          : nextValue;
    }
  }

  return result;
}

function setNestedPath(target: AnyRecord, path: readonly string[], value: unknown): void {
  let cursor = target;

  for (let index = 0; index < path.length; index += 1) {
    const key = path[index];

    if (index === path.length - 1) {
      cursor[key] = value;
      return;
    }

    const next = cursor[key];

    if (!isPlainObject(next)) {
      cursor[key] = {};
    }

    cursor = cursor[key] as AnyRecord;
  }
}

function mergePlainObjects(first: AnyRecord, second: AnyRecord): AnyRecord {
  const result = { ...first };

  for (const [key, value] of Object.entries(second)) {
    const previousValue = result[key];

    result[key] =
      isPlainObject(previousValue) && isPlainObject(value)
        ? mergePlainObjects(previousValue, value)
        : value;
  }

  return result;
}
