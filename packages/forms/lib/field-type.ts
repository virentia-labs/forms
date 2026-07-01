import type { AnyField, FieldType } from "./types";

export function defineField<FieldValue extends AnyField>(field: FieldValue): FieldValue {
  return field;
}

export function fieldType<Factory extends (...args: any[]) => AnyField>(config: {
  kind?: string;
  create: Factory;
}): FieldType<Factory> {
  return makeFieldType(config.create);
}

function makeFieldType<Factory extends (...args: any[]) => AnyField>(factory: Factory): FieldType<Factory> {
  const callable = ((...args: Parameters<Factory>) => factory(...args)) as FieldType<Factory>;

  callable.extend = ((extension: any) =>
    makeFieldType(((...args: any[]) => extension.create(callable, ...args)) as any)) as FieldType<Factory>["extend"];

  return callable;
}
