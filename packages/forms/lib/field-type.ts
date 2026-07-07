import { effect } from "@virentia/core";
import type { AnyField, FieldType } from "./types";

// Methods that read synchronously and must stay plain functions.
const syncAccessors = new Set<string>(["read", "serialize", "readFields"]);

function isUnit(value: unknown): boolean {
  return (
    (typeof value === "function" || typeof value === "object") &&
    value !== null &&
    "node" in (value as object)
  );
}

/**
 * Wraps a field's user-defined async methods in effects, so triggering them
 * stays a direct effect await for the caller and never drops the ambient scope
 * (the same rule the built-in fields follow). Units (stores, events, the field's
 * own effects) and synchronous accessors (`read`, `serialize`, `readFields`) are
 * left untouched. Idempotent — already-wrapped methods are units and skipped.
 */
function wrapFieldMethods<FieldValue extends AnyField>(field: FieldValue): FieldValue {
  const kind = (field as { kind?: string }).kind ?? "field";
  const result = { ...field } as Record<string, unknown>;

  for (const key of Object.keys(field)) {
    const value = (field as Record<string, unknown>)[key];

    if (typeof value !== "function" || syncAccessors.has(key) || isUnit(value)) {
      continue;
    }

    const method = value as (payload?: unknown) => unknown;
    result[key] = effect(async (payload: unknown) => await method(payload), `${kind}.${key}`);
  }

  return result as FieldValue;
}

export function defineField<FieldValue extends AnyField>(field: FieldValue): FieldValue {
  return wrapFieldMethods(field);
}

export function fieldType<Factory extends (...args: any[]) => AnyField>(config: {
  kind?: string;
  create: Factory;
}): FieldType<Factory> {
  return makeFieldType(config.create);
}

function makeFieldType<Factory extends (...args: any[]) => AnyField>(factory: Factory): FieldType<Factory> {
  const callable = ((...args: Parameters<Factory>) =>
    wrapFieldMethods(factory(...args))) as FieldType<Factory>;

  callable.extend = ((extension: any) =>
    makeFieldType(((...args: any[]) => extension.create(callable, ...args)) as any)) as FieldType<Factory>["extend"];

  return callable;
}
