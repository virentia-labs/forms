import {
  computed,
  effect,
  event,
  reaction,
  scoped,
  store,
  type Store,
} from "@virentia/core";
import { createField } from "./field";
import {
  clampIndex,
  createValidationContext,
  createValidationDependencyTracker,
  hasErrors,
  hasIndex,
  ignoreAbort,
  isFieldContract,
  normalizeField,
  readArrayErrors,
  readArrayValue,
  readStoreSnapshot,
  runFieldValidators,
  toArray,
  type AnyStore,
} from "./shared";
import type {
  AnyField,
  ArrayField,
  ArrayFieldErrors,
  CreateArrayFieldOptions,
  Field,
  FieldError,
  FieldErrors,
} from "./types";

export function createArrayField<
  Value,
  ItemField extends AnyField = Field<Value>,
>(
  initial: readonly Value[] = [],
  options: CreateArrayFieldOptions<Value, ItemField> = {},
): ArrayField<Value, ItemField> {
  const createItem =
    options.createItem ??
    ((value: Value) => createField(value) as unknown as ItemField);
  const validators = toArray(options.validate);
  const strategies = new Set(options.validationStrategies ?? []);
  const itemsBox = store(
    initial.map((value, index) => createItem(value, index)),
  );
  const innerErrorBox = store<FieldError>(null);
  const outerErrorBox = store<FieldError>(null);
  const items = computed(() => itemsBox.value as readonly ItemField[]);
  const itemFields = computed(
    () =>
      Object.fromEntries(
        itemsBox.value.map((field, index) => [String(index), field]),
      ) as Readonly<Record<string, ItemField>>,
  );
  const state = computed(() => readArrayValue<Value>(itemsBox.value));
  const fields = itemFields as Store<Readonly<Record<string, AnyField>>>;
  const length = computed(() => itemsBox.value.length);
  const innerErrors = computed(
    () =>
      (innerErrorBox.value ??
        readArrayErrors(itemsBox.value, "innerErrors")) as ArrayFieldErrors<
        FieldErrors<ItemField>
      >,
  );
  const outerErrors = computed(
    () =>
      (outerErrorBox.value ??
        readArrayErrors(itemsBox.value, "outerErrors")) as ArrayFieldErrors<
        FieldErrors<ItemField>
      >,
  );
  const errors = computed(
    () =>
      (outerErrorBox.value ??
        innerErrorBox.value ??
        readArrayErrors(itemsBox.value, "errors")) as ArrayFieldErrors<
        FieldErrors<ItemField>
      >,
  );
  const isValid = computed(
    () =>
      !hasErrors(outerErrorBox.value) &&
      !hasErrors(innerErrorBox.value) &&
      itemsBox.value.every((field) =>
        readStoreSnapshot(normalizeField(field).isValid),
      ),
  );
  const changed = event<readonly Value[]>("arrayField.changed");
  const errorsChanged = event<ArrayFieldErrors<FieldErrors<ItemField>>>(
    "arrayField.errorsChanged",
  );
  const validated = event<readonly Value[]>("arrayField.validated");
  const validationFailed = event<readonly Value[]>(
    "arrayField.validationFailed",
  );

  const validateFx = effect<void, void, Error>(
    async (_payload, { scope, signal }) => {
      const dependencies = new Set<AnyStore>();
      const ctx = createValidationContext({
        path: [],
        signal,
        dependencies,
        scope,
      });

      for (const field of itemsBox.value) {
        await normalizeField(field).validate();
      }

      // Run the (plain-async, external-boundary) validators inside `scope`, so the
      // ambient scope survives a multi-tick user validator and the writes/emits below
      // run with `scope` active. Only the runner is wrapped — the nested per-item
      // `setInnerErrors` effects must stay outside, or `scoped` would gather their
      // reactions and disturb error application / dep-tracking.
      const nextError = (await scoped(scope, () =>
        runFieldValidators(validators, read(), ctx),
      )) as FieldError | readonly unknown[];

      if (signal.aborted) {
        return;
      }

      // The write/apply/emit after-work needs `scope` too — on a detached
      // dependency-tracker re-run there is no ambient scope here. Wrap each nested
      // effect call and the sync writes/reads in their own `scoped(scope, …)` (a
      // single `scoped(scope, async …)` block that awaits nested effects would gather
      // their reactions and break error application).
      const errorIsArray = Array.isArray(nextError);
      scoped(scope, () => {
        innerErrorBox.value = (errorIsArray ? null : nextError) as FieldError;
      });

      if (errorIsArray) {
        const itemErrors = nextError as readonly unknown[];
        const currentItems = itemsBox.value;
        for (let index = 0; index < currentItems.length; index += 1) {
          // An error array shorter than the item list (or a hole) does not address
          // the trailing items — leave their own validation result intact instead
          // of overwriting it with a phantom `undefined` (which reads as invalid).
          if (itemErrors[index] === undefined) {
            continue;
          }

          await scoped(scope, () =>
            normalizeField(currentItems[index]).setInnerErrors(
              itemErrors[index],
            ),
          );
        }
      }

      scoped(scope, () => {
        dependencyTracker.update(scope, dependencies);

        errorsChanged(readStoreSnapshot(errors));

        if (readStoreSnapshot(isValid)) {
          validated(read());
        } else {
          validationFailed(read());
        }
      });
    },
    "arrayField.validate.effect",
  );

  // `validate` is a plain event; the reaction below runs validation. Revalidating
  // is re-dispatching it — a direct unit await, no `async` wrapper.
  const validate = event<void>("arrayField.validate");
  reaction({
    on: validate,
    async run() {
      validateFx.abort();
      try {
        await validateFx();
      } catch (error) {
        ignoreAbort(error);
      }
    },
  });

  const dependencyTracker = createValidationDependencyTracker(validate);
  const isValidationPending = computed(
    () =>
      validateFx.pending.value ||
      itemsBox.value.some((field) =>
        readStoreSnapshot(normalizeField(field).isValidationPending),
      ),
  );

  const fillFx = effect<readonly Value[], void, Error>(async (nextValues) => {
    const nextItems = itemsBox.value.slice(0, nextValues.length);
    const fills: Array<() => Promise<void>> = [];

    for (let index = 0; index < nextValues.length; index += 1) {
      const field = nextItems[index];

      if (field) {
        const normalized = normalizeField(field);
        const value = nextValues[index];
        fills.push(() => normalized.fill(value));
      } else {
        nextItems[index] = createItem(nextValues[index], index);
      }
    }

    itemsBox.value = nextItems;

    for (const fill of fills) {
      await fill();
    }

    changed(read());
    errorsChanged(readStoreSnapshot(errors));

    if (strategies.has("change")) {
      await validate();
    }
  }, "arrayField.fill.effect");

  const resetFx = effect<void, void>(async () => {
    itemsBox.value = initial.map((item, index) => createItem(item, index));
    innerErrorBox.value = null;
    outerErrorBox.value = null;

    for (const field of itemsBox.value) {
      await normalizeField(field).reset();
    }

    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.reset.effect");

  const pushFx = effect<Value | ItemField, void, Error>(async (input) => {
    itemsBox.value = [
      ...itemsBox.value,
      toArrayItem(input, itemsBox.value.length),
    ];
    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.push.effect");

  const unshiftFx = effect<Value | ItemField, void, Error>(async (input) => {
    itemsBox.value = [toArrayItem(input, 0), ...itemsBox.value];
    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.unshift.effect");

  const insertFx = effect<
    { index: number; input: Value | ItemField },
    void,
    Error
  >(async ({ index, input }) => {
    const safeIndex = clampIndex(index, 0, itemsBox.value.length);
    const next = itemsBox.value.slice();
    next.splice(safeIndex, 0, toArrayItem(input, safeIndex));
    itemsBox.value = next;
    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.insert.effect");

  const removeFx = effect<number, void, Error>(async (index) => {
    if (!hasIndex(itemsBox.value, index)) {
      return;
    }

    const next = itemsBox.value.slice();
    next.splice(index, 1);
    itemsBox.value = next;
    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.remove.effect");

  const replaceFx = effect<
    { index: number; input: Value | ItemField },
    void,
    Error
  >(async ({ index, input }) => {
    if (!hasIndex(itemsBox.value, index)) {
      await insertFx({ index, input });
      return;
    }

    const next = itemsBox.value.slice();
    const current = next[index];

    if (isFieldContract(input)) {
      next[index] = input as ItemField;
      itemsBox.value = next;
    } else {
      await normalizeField(current).fill(input);
    }

    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.replace.effect");

  const moveFx = effect<{ from: number; to: number }, void, Error>(
    async ({ from, to }) => {
      if (!hasIndex(itemsBox.value, from)) {
        return;
      }

      const safeTo = clampIndex(to, 0, itemsBox.value.length - 1);
      const next = itemsBox.value.slice();
      const [field] = next.splice(from, 1);
      next.splice(safeTo, 0, field);
      itemsBox.value = next;
      changed(read());
      errorsChanged(readStoreSnapshot(errors));
    },
    "arrayField.move.effect",
  );

  const swapFx = effect<{ first: number; second: number }, void, Error>(
    async ({ first, second }) => {
      if (
        !hasIndex(itemsBox.value, first) ||
        !hasIndex(itemsBox.value, second)
      ) {
        return;
      }

      const next = itemsBox.value.slice();
      [next[first], next[second]] = [next[second], next[first]];
      itemsBox.value = next;
      changed(read());
      errorsChanged(readStoreSnapshot(errors));
    },
    "arrayField.swap.effect",
  );

  const clearFx = effect<void, void, Error>(async () => {
    itemsBox.value = [];
    innerErrorBox.value = null;
    outerErrorBox.value = null;
    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.clear.effect");

  const setInnerErrorsFx = effect<
    ArrayFieldErrors<FieldErrors<ItemField>>,
    void,
    Error
  >(async (nextErrors) => {
    if (Array.isArray(nextErrors)) {
      innerErrorBox.value = null;
      const itemErrors = nextErrors as readonly unknown[];
      const currentItems = itemsBox.value;
      for (let index = 0; index < currentItems.length; index += 1) {
        // Entries the array does not cover (or explicit holes) leave the
        // corresponding item untouched rather than injecting a phantom
        // `undefined` error that would make the item report invalid.
        if (itemErrors[index] === undefined) {
          continue;
        }

        await normalizeField(currentItems[index]).setInnerErrors(
          itemErrors[index],
        );
      }
    } else {
      innerErrorBox.value = nextErrors as FieldError;
    }

    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.setInnerErrors.effect");

  const setOuterErrorsFx = effect<
    ArrayFieldErrors<FieldErrors<ItemField>>,
    void,
    Error
  >(async (nextErrors) => {
    if (Array.isArray(nextErrors)) {
      outerErrorBox.value = null;
      const itemErrors = nextErrors as readonly unknown[];
      const currentItems = itemsBox.value;
      for (let index = 0; index < currentItems.length; index += 1) {
        // Entries the array does not cover (or explicit holes) leave the
        // corresponding item untouched rather than injecting a phantom
        // `undefined` error that would make the item report invalid.
        if (itemErrors[index] === undefined) {
          continue;
        }

        await normalizeField(currentItems[index]).setOuterErrors(
          itemErrors[index],
        );
      }
    } else {
      outerErrorBox.value = nextErrors as FieldError;
    }

    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.setOuterErrors.effect");

  const clearInnerErrorsFx = effect<void, void>(async () => {
    innerErrorBox.value = null;
    for (const field of itemsBox.value) {
      await normalizeField(field).clearInnerErrors();
    }
    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.clearInnerErrors.effect");

  const clearOuterErrorsFx = effect<void, void>(async () => {
    outerErrorBox.value = null;
    for (const field of itemsBox.value) {
      await normalizeField(field).clearOuterErrors();
    }
    errorsChanged(readStoreSnapshot(errors));
  }, "arrayField.clearOuterErrors.effect");

  const field: ArrayField<Value, ItemField> = {
    kind: "array",
    state,
    items,
    itemFields,
    fields,
    length,
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
    clearInnerErrors: () => clearInnerErrorsFx(),
    clearOuterErrors: () => clearOuterErrorsFx(),
    push: (input) => pushFx(input),
    unshift: (input) => unshiftFx(input),
    insert: (index, input) => insertFx({ index, input }),
    remove: (index) => removeFx(index),
    pop: () => removeFx(itemsBox.value.length - 1),
    replace: (index, input) => replaceFx({ index, input }),
    move: (from, to) => moveFx({ from, to }),
    swap: (first, second) => swapFx({ first, second }),
    clear: () => clearFx(),
    read,
    readFields() {
      return readStoreSnapshot(fields);
    },
    serialize() {
      return { value: read(), errors: readStoreSnapshot(errors) };
    },
  };

  return field;

  function read(): readonly Value[] {
    return readArrayValue(itemsBox.value);
  }

  function toArrayItem(input: Value | ItemField, index: number): ItemField {
    return isFieldContract(input)
      ? (input as ItemField)
      : createItem(input as Value, index);
  }
}
