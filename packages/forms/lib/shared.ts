import {
  computed,
  effect,
  event,
  getCurrentScope,
  owner,
  reaction,
  scoped,
  type EventCallable,
  type Scope,
  type Store,
  type StoreWritable,
} from "@virentia/core";
import type {
  AnyField,
  FieldContract,
  FieldValidator,
  FormValidator,
  MaybePromise,
  NormalizedField,
  ValidationContext,
  ValidationEffect,
  ValidationResult,
  ValidationStrategy,
  ValidationUnit,
} from "./types";

export type ValidationRunReason = ValidationStrategy | "dependency";
export type AnyStore<T = any> = Store<T> | StoreWritable<T>;
export type PayloadArgs<T> = undefined extends T ? [payload?: T] : [payload: T];
export type AnyRecord = Record<string, any>;

const normalizedFields = new WeakMap<object, NormalizedField<any, any, any>>();
const nativeStoreKeys = new Set<PropertyKey>([
  "node",
  "writable",
  "subscribe",
  "map",
  "filter",
  "filterMap",
]);

export function normalizeField<Value, Errors, Fill>(
  field: FieldContract<Value, Errors, Fill>,
): NormalizedField<Value, Errors, Fill> {
  const cached = normalizedFields.get(field as object);

  if (cached) {
    return cached as NormalizedField<Value, Errors, Fill>;
  }

  const readFields = () => readFieldChildren(field);
  const hasChildren = () => Object.keys(readFields()).length > 0;
  const emptyErrors = computed(() => null as Errors);
  const childrenErrors = computed(() => readObjectErrors(readFields(), "errors") as Errors);
  const childrenInnerErrors = computed(() => readObjectErrors(readFields(), "innerErrors") as Errors);
  const childrenOuterErrors = computed(() => readObjectErrors(readFields(), "outerErrors") as Errors);
  const errors = field.errors ?? (hasChildren() ? childrenErrors : emptyErrors);
  const innerErrors = field.innerErrors ?? (hasChildren() ? childrenInnerErrors : emptyErrors);
  const outerErrors = field.outerErrors ?? (hasChildren() ? childrenOuterErrors : emptyErrors);
  const changed = field.changed ?? event<Value>(`${field.kind}.changed`);
  const errorsChanged = field.errorsChanged ?? event<Errors>(`${field.kind}.errorsChanged`);
  const validated = field.validated ?? event<Value>(`${field.kind}.validated`);
  const validationFailed = field.validationFailed ?? event<Value>(`${field.kind}.validationFailed`);
  const isValid = field.isValid ?? computed(() => !hasErrors(readStoreSnapshot(errors)));
  const isValidationPending =
    field.isValidationPending ??
    computed(() =>
      Object.values(readFields()).some((child) =>
        readStoreSnapshot(normalizeField(child).isValidationPending),
      ),
    );
  // Synthesized methods are effects (never plain async): the caller awaits them
  // with a direct effect await, so its scope survives even when it keeps working
  // afterwards. Each delegates to the field's own method when present, otherwise
  // traverses children via the schema effects.
  const fillFx = effect<Fill, void>(async (payload: Fill) => {
    if (field.fill) {
      await field.fill(payload);
      return;
    }

    await fillSchemaFx({ schema: readFields(), values: payload as AnyRecord });
  }, `${field.kind}.normalizedFill`);
  const resetFx = effect<void, void>(async () => {
    if (field.reset) {
      await field.reset();
      return;
    }

    await resetSchemaFx(readFields());
  }, `${field.kind}.normalizedReset`);
  const setInnerErrorsFx = effect<Errors, void>(async (nextErrors: Errors) => {
    if (field.setInnerErrors) {
      await field.setInnerErrors(nextErrors);
      return;
    }

    await applyErrorsToSchemaFx({ schema: readFields(), errors: nextErrors as AnyRecord, channel: "inner" });
  }, `${field.kind}.normalizedSetInnerErrors`);
  const setOuterErrorsFx = effect<Errors, void>(async (nextErrors: Errors) => {
    if (field.setOuterErrors) {
      await field.setOuterErrors(nextErrors);
      return;
    }

    await applyErrorsToSchemaFx({ schema: readFields(), errors: nextErrors as AnyRecord, channel: "outer" });
  }, `${field.kind}.normalizedSetOuterErrors`);
  const clearInnerErrorsFx = effect<void, void>(async () => {
    if (field.clearInnerErrors) {
      await field.clearInnerErrors();
      return;
    }

    await clearSchemaErrorsFx({ schema: readFields(), channel: "inner" });
  }, `${field.kind}.normalizedClearInnerErrors`);
  const clearOuterErrorsFx = effect<void, void>(async () => {
    if (field.clearOuterErrors) {
      await field.clearOuterErrors();
      return;
    }

    await clearSchemaErrorsFx({ schema: readFields(), channel: "outer" });
  }, `${field.kind}.normalizedClearOuterErrors`);

  let validate = field.validate;

  if (!validate) {
    // Synthesized `validate` is a plain event driven by a reaction/effect, so
    // awaiting it is a direct unit await (no `createEventMethod` async wrapper).
    const validateEvent = event<void>(`${field.kind}.validate`);
    const validateFx = effect<void, void>(async () => {
      for (const child of Object.values(readFields())) {
        await normalizeField(child).validate();
      }
    }, `${field.kind}.normalizedValidate`);

    reaction({
      on: validateEvent,
      async run() {
        validateFx.abort();
        try {
          await validateFx();
        } catch (error) {
          ignoreAbort(error);
        }
      },
    });

    validate = validateEvent;
  }

  const normalized: NormalizedField<Value, Errors, Fill> = {
    ...field,
    errors,
    innerErrors,
    outerErrors,
    isValid,
    isValidationPending,
    changed,
    errorsChanged,
    validate,
    validated,
    validationFailed,
    fill: fillFx,
    reset: resetFx,
    setInnerErrors: setInnerErrorsFx,
    setOuterErrors: setOuterErrorsFx,
    clearInnerErrors: clearInnerErrorsFx,
    clearOuterErrors: clearOuterErrorsFx,
    read() {
      if (field.read) {
        return field.read();
      }

      if (field.serialize) {
        return field.serialize().value;
      }

      return readStoreSnapshot(field.state);
    },
    readFields,
  };

  normalizedFields.set(field as object, normalized);
  return normalized;
}

export function readStoreSnapshot<T>(unit: Store<T> | StoreWritable<T>): T {
  const keys = Reflect.ownKeys(unit as object).filter((key) => !nativeStoreKeys.has(key));

  if (keys.length === 1 && keys[0] === "value") {
    return Reflect.get(unit as object, "value") as T;
  }

  if (isArrayStoreSnapshot(unit, keys)) {
    const length = Reflect.get(unit as object, "length") as number;
    return Array.from({ length }, (_item, index) => Reflect.get(unit as object, String(index))) as T;
  }

  return Object.fromEntries(keys.map((key) => [key, Reflect.get(unit as object, key)])) as T;
}

/**
 * Runs `fn` with `scope` active and restores the previously active scope
 * synchronously, returning whatever `fn` produced.
 *
 * `scoped(scope, asyncFn)` only restores the previous scope once the returned
 * promise settles (see @virentia/core `runScopeTask`), so it keeps `scope`
 * active across every `await` inside `asyncFn`. When such work is launched
 * detached from a reaction, that late restoration writes the reaction's firing
 * scope back into the global active scope and leaks it into unrelated work.
 *
 * `emitIn` instead keeps `scope` active only for the synchronous portion of
 * `fn` — long enough to dispatch units and read stores under the right scope —
 * and hands back the resulting promise for the caller to await outside of any
 * scope. Awaiting a promise needs no active scope, so nothing leaks.
 */
export function emitIn<T>(scope: Scope, fn: () => T): T {
  let result!: T;

  scoped(scope, () => {
    result = fn();
  });

  return result;
}

/**
 * Swallows the `AbortError` a superseded effect run rejects with (cancel-previous
 * validation), while re-throwing anything else. Lets callers `await` a validation
 * that a newer run aborted without the abort surfacing as a failure.
 */
export function ignoreAbort(error: unknown): void {
  if ((error as { name?: string } | null)?.name === "AbortError") {
    return;
  }

  throw error;
}

export function createEventMethod<T>(
  name: string,
  handler: (payload: T) => Promise<void>,
): EventCallable<T> {
  const signal = event<T>(name);
  const method = (async (...args: PayloadArgs<T>) => {
    const callScope = getCurrentScope();
    const payload = args[0] as T;
    await handler(payload);

    const dispatch = signal as (...payload: PayloadArgs<T>) => Promise<void>;

    if (callScope) {
      await emitIn(callScope, () => dispatch(...args));
      return;
    }

    await dispatch(...args);
  }) as EventCallable<T>;

  return Object.assign(method, signal);
}

export function createValidationDependencyTracker(runAgain: () => Promise<void>) {
  const disposers = new WeakMap<Scope, () => void>();

  return {
    update(scope: Scope, dependencies: ReadonlySet<AnyStore>): void {
      disposers.get(scope)?.();

      if (dependencies.size === 0) {
        disposers.delete(scope);
        return;
      }

      // Watch the read stores through a scope-bound reaction that awaits the
      // re-run. Unlike a raw `store.subscribe` callback, a reaction restores the
      // active scope after it settles even when it fires detached (from a write
      // in a suspended scope), so revalidation never clobbers the ambient scope
      // of concurrent work.
      const dispose = owner((disposeOwner) => {
        reaction({
          on: [...dependencies],
          scope,
          async run() {
            try {
              await runAgain();
            } catch (error) {
              ignoreAbort(error);
            }
          },
        });

        return disposeOwner;
      });

      disposers.set(scope, dispose);
    },
  };
}

export function createValidationContext(config: {
  path: readonly string[];
  signal: AbortSignal;
  dependencies: Set<AnyStore>;
  scope: Scope;
}): ValidationContext {
  return {
    path: config.path,
    signal: config.signal,
    read<T>(unit: Store<T> | StoreWritable<T>): T {
      config.dependencies.add(unit);
      return scoped(config.scope, () => readStoreSnapshot(unit));
    },
  };
}

// Validator runners are plain async — the one place it is safe, because the only
// thing they `await` is a *user validator* (an external boundary), not a unit
// that needs the ambient scope. The caller does a single `await` and then reads
// synchronously.
export async function runFieldValidators<Value, Errors>(
  validators: readonly FieldValidator<Value, Errors>[],
  value: Value,
  ctx: ValidationContext,
): Promise<Errors | null> {
  for (const validator of validators) {
    if (ctx.signal.aborted) {
      return null;
    }

    const error = await runValidationUnit(validator, value, ctx);

    if (error !== null && error !== undefined && hasErrors(error)) {
      return error;
    }
  }

  return null;
}

export async function runFormValidators<Values, Errors>(
  validators: readonly FormValidator<Values, Errors>[],
  values: Values,
  ctx: ValidationContext,
): Promise<Errors | null> {
  for (const validator of validators) {
    if (ctx.signal.aborted) {
      return null;
    }

    const errors = await runValidationUnit(validator, values, ctx);

    if (errors !== null && errors !== undefined && hasErrors(errors)) {
      return errors;
    }
  }

  return null;
}

function runValidationUnit<Value, Errors>(
  validator: ValidationUnit<Value, Errors>,
  value: Value,
  ctx: ValidationContext,
): Promise<ValidationResult<Errors>> | MaybePromise<ValidationResult<Errors>> {
  if (isValidationEffect(validator)) {
    return validator({ value, ctx }, { signal: ctx.signal });
  }

  return validator(value, ctx);
}

function isValidationEffect<Value, Errors>(
  validator: ValidationUnit<Value, Errors>,
): validator is ValidationEffect<Value, Errors> {
  return Boolean(
    typeof validator === "function" &&
      "pending" in validator &&
      "inFlight" in validator &&
      "done" in validator &&
      "failed" in validator,
  );
}

export function readSchemaValues(schema: AnyRecord): AnyRecord {
  return Object.fromEntries(
    Object.entries(schema).map(([key, fieldOrSchema]) => [
      key,
      isFieldContract(fieldOrSchema)
        ? normalizeField(fieldOrSchema).read()
        : readSchemaValues(fieldOrSchema),
    ]),
  );
}

export function readSchemaErrors(schema: AnyRecord, channel: "errors" | "innerErrors" | "outerErrors"): AnyRecord {
  return Object.fromEntries(
    Object.entries(schema).map(([key, fieldOrSchema]) => [
      key,
      isFieldContract(fieldOrSchema)
        ? readStoreSnapshot(normalizeField(fieldOrSchema)[channel])
        : readSchemaErrors(fieldOrSchema, channel),
    ]),
  );
}

export function readObjectValues(fields: Record<string, AnyField>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, normalizeField(field).read()]));
}

export function readObjectErrors(
  fields: Record<string, AnyField>,
  channel: "errors" | "innerErrors" | "outerErrors",
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, readStoreSnapshot(normalizeField(field)[channel])]),
  );
}

export function readArrayValue<Value>(items: readonly AnyField[]): readonly Value[] {
  return items.map((field) => normalizeField(field).read()) as readonly Value[];
}

export function readArrayErrors(
  items: readonly AnyField[],
  channel: "errors" | "innerErrors" | "outerErrors",
): readonly unknown[] {
  return items.map((field) => readStoreSnapshot(normalizeField(field)[channel]));
}

// Schema traversal runs as per-call effects: the caller awaits one of these with
// a direct effect await, which restores the caller's scope on return. Recursion
// re-invokes the same effect (also a direct await).
export const fillSchemaFx = effect<{ schema: AnyRecord; values: AnyRecord }, void>(
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

export const resetSchemaFx = effect<AnyRecord, void>(async (schema) => {
  for (const fieldOrSchema of Object.values(schema)) {
    if (isFieldContract(fieldOrSchema)) {
      await normalizeField(fieldOrSchema).reset();
    } else {
      await resetSchemaFx(fieldOrSchema);
    }
  }
}, "forms.resetSchema");

export const validateSchemaFx = effect<AnyRecord, void>(async (schema) => {
  for (const fieldOrSchema of Object.values(schema)) {
    if (isFieldContract(fieldOrSchema)) {
      await normalizeField(fieldOrSchema).validate();
    } else {
      await validateSchemaFx(fieldOrSchema);
    }
  }
}, "forms.validateSchema");

export const clearSchemaErrorsFx = effect<{ schema: AnyRecord; channel: "inner" | "outer" }, void>(
  async ({ schema, channel }) => {
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
  },
  "forms.clearSchemaErrors",
);

export const applyErrorsToSchemaFx = effect<
  { schema: AnyRecord; errors: AnyRecord; channel: "inner" | "outer" },
  void
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
      await applyErrorsToSchemaFx({ schema: fieldOrSchema, errors: errorValue as AnyRecord, channel });
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

export function schemaIsPending(schema: AnyRecord): boolean {
  return Object.values(schema).some((fieldOrSchema) =>
    isFieldContract(fieldOrSchema)
      ? readStoreSnapshot(normalizeField(fieldOrSchema).isValidationPending)
      : schemaIsPending(fieldOrSchema),
  );
}

export function attachSchemaChangeValidation(schema: AnyRecord, validate: () => Promise<void>): void {
  for (const fieldOrSchema of Object.values(schema)) {
    if (isFieldContract(fieldOrSchema)) {
      const field = normalizeField(fieldOrSchema);

      reaction({
        on: field.changed,
        run() {
          void emitIn(requireCurrentScope(), () => validate());
        },
      });
    } else {
      attachSchemaChangeValidation(fieldOrSchema, validate);
    }
  }
}

export function pickSchema(schema: AnyRecord, selection: AnyRecord): AnyRecord {
  const result: AnyRecord = {};

  for (const [key, value] of Object.entries(selection)) {
    if (!(key in schema)) {
      continue;
    }

    if (value === true || isFieldContract(schema[key])) {
      result[key] = schema[key];
    } else {
      result[key] = pickSchema(schema[key], value as AnyRecord);
    }
  }

  return result;
}

function readFieldChildren(field: FieldContract<any, any, any>): Readonly<Record<string, AnyField>> {
  if (field.readFields) {
    return field.readFields();
  }

  if (!field.fields) {
    return {};
  }

  if (isStoreUnit(field.fields)) {
    return readStoreSnapshot(field.fields as Store<Readonly<Record<string, AnyField>>>);
  }

  return field.fields;
}

export function isFieldContract(value: unknown): value is AnyField {
  return Boolean(
    value &&
      typeof value === "object" &&
      "kind" in value &&
      "state" in value &&
      "fill" in value &&
      "reset" in value,
  );
}

function isStoreUnit(value: unknown): value is AnyStore {
  return Boolean(
    value &&
      typeof value === "object" &&
      "node" in value &&
      "subscribe" in value &&
      typeof (value as { subscribe?: unknown }).subscribe === "function",
  );
}

export function isPlainObject(value: unknown): value is AnyRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayStoreSnapshot(unit: AnyStore, keys: readonly PropertyKey[]): boolean {
  return (
    keys.includes("length") &&
    keys.every((key) => key === "length" || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key))) &&
    typeof Reflect.get(unit as object, "length") === "number"
  );
}

export function hasErrors(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(hasErrors);
  }

  if (typeof value === "object") {
    return Object.values(value).some(hasErrors);
  }

  return true;
}

export function deepEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) {
    return true;
  }

  if (typeof first !== typeof second) {
    return false;
  }

  if (!first || !second || typeof first !== "object" || typeof second !== "object") {
    return false;
  }

  if (Array.isArray(first) || Array.isArray(second)) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
      return false;
    }

    return first.every((item, index) => deepEqual(item, second[index]));
  }

  const firstKeys = Object.keys(first as AnyRecord);
  const secondKeys = Object.keys(second as AnyRecord);

  if (firstKeys.length !== secondKeys.length) {
    return false;
  }

  return firstKeys.every((key) => deepEqual((first as AnyRecord)[key], (second as AnyRecord)[key]));
}

export function cloneSnapshot<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneSnapshot(item)) as T;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneSnapshot(item)]),
    ) as T;
  }

  return value;
}

export function toArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }

  return (Array.isArray(value) ? value : [value]) as readonly T[];
}

export function emptyFields(): Readonly<Record<string, AnyField>> {
  return {};
}

export function requireCurrentScope(): Scope {
  const scope = getCurrentScope();

  if (!scope) {
    throw new Error("Scope is required");
  }

  return scope;
}

export function clampIndex(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function hasIndex(items: readonly unknown[], index: number): boolean {
  return index >= 0 && index < items.length;
}

export function appendUnique<T>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values : [...values, value];
}
