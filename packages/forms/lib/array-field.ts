import { computed, event, scoped, store, type Store } from "@virentia/core";
import { createField } from "./field";
import {
  clampIndex,
  createEventMethod,
  createValidationContext,
  createValidationDependencyTracker,
  hasErrors,
  hasIndex,
  isFieldContract,
  normalizeField,
  readArrayErrors,
  readArrayValue,
  readStoreSnapshot,
  requireCurrentScope,
  runFieldValidators,
  toArray,
  type AnyStore,
  type ValidationRunReason,
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

export function createArrayField<Value, ItemField extends AnyField = Field<Value>>(
  initial: readonly Value[] = [],
  options: CreateArrayFieldOptions<Value, ItemField> = {},
): ArrayField<Value, ItemField> {
  const createItem = options.createItem ?? ((value: Value) => createField(value) as unknown as ItemField);
  const validators = toArray(options.validate);
  const strategies = new Set(options.validationStrategies ?? []);
  const itemsBox = store(initial.map((value, index) => createItem(value, index)));
  const innerErrorBox = store<FieldError>(null);
  const outerErrorBox = store<FieldError>(null);
  const validationPendingBox = store(false);
  const items = computed(() => itemsBox.value as readonly ItemField[]);
  const itemFields = computed(
    () => Object.fromEntries(itemsBox.value.map((field, index) => [String(index), field])) as Readonly<Record<string, ItemField>>,
  );
  const state = computed(() => readArrayValue<Value>(itemsBox.value));
  const fields = itemFields as Store<Readonly<Record<string, AnyField>>>;
  const length = computed(() => itemsBox.value.length);
  const innerErrors = computed(
    () => (innerErrorBox.value ?? readArrayErrors(itemsBox.value, "innerErrors")) as ArrayFieldErrors<FieldErrors<ItemField>>,
  );
  const outerErrors = computed(
    () => (outerErrorBox.value ?? readArrayErrors(itemsBox.value, "outerErrors")) as ArrayFieldErrors<FieldErrors<ItemField>>,
  );
  const errors = computed(
    () => (outerErrorBox.value ?? innerErrorBox.value ?? readArrayErrors(itemsBox.value, "errors")) as ArrayFieldErrors<FieldErrors<ItemField>>,
  );
  const isValid = computed(
    () =>
      !hasErrors(outerErrorBox.value) &&
      !hasErrors(innerErrorBox.value) &&
      itemsBox.value.every((field) => readStoreSnapshot(normalizeField(field).isValid)),
  );
  const isValidationPending = computed(
    () =>
      validationPendingBox.value ||
      itemsBox.value.some((field) => readStoreSnapshot(normalizeField(field).isValidationPending)),
  );
  const changed = event<readonly Value[]>("arrayField.changed");
  const errorsChanged = event<ArrayFieldErrors<FieldErrors<ItemField>>>("arrayField.errorsChanged");
  const validated = event<readonly Value[]>("arrayField.validated");
  const validationFailed = event<readonly Value[]>("arrayField.validationFailed");
  const dependencyTracker = createValidationDependencyTracker(() => runValidation("dependency"));
  let validationController: AbortController | null = null;
  let validationVersion = 0;

  async function emitState(): Promise<void> {
    await Promise.all([changed(read()), errorsChanged(readStoreSnapshot(errors))]);
  }

  async function fill(nextValues: readonly Value[]): Promise<void> {
    const nextItems = itemsBox.value.slice(0, nextValues.length);
    const work: Promise<void>[] = [];

    for (let index = 0; index < nextValues.length; index += 1) {
      const field = nextItems[index];

      if (field) {
        work.push(normalizeField(field).fill(nextValues[index]));
      } else {
        nextItems[index] = createItem(nextValues[index], index);
      }
    }

    itemsBox.value = nextItems;
    await Promise.all(work);
    await emitState();

    if (strategies.has("change")) {
      await validate();
    }
  }

  async function reset(): Promise<void> {
    itemsBox.value = initial.map((item, index) => createItem(item, index));
    innerErrorBox.value = null;
    outerErrorBox.value = null;
    await Promise.all(itemsBox.value.map((field) => normalizeField(field).reset()));
    await emitState();
  }

  async function push(input: Value | ItemField): Promise<void> {
    const nextField = toArrayItem(input, itemsBox.value.length);
    itemsBox.value = [...itemsBox.value, nextField];
    await emitState();
  }

  async function unshift(input: Value | ItemField): Promise<void> {
    const nextField = toArrayItem(input, 0);
    itemsBox.value = [nextField, ...itemsBox.value];
    await emitState();
  }

  async function insert(index: number, input: Value | ItemField): Promise<void> {
    const safeIndex = clampIndex(index, 0, itemsBox.value.length);
    const next = itemsBox.value.slice();
    next.splice(safeIndex, 0, toArrayItem(input, safeIndex));
    itemsBox.value = next;
    await emitState();
  }

  async function remove(index: number): Promise<void> {
    if (!hasIndex(itemsBox.value, index)) {
      return;
    }

    const next = itemsBox.value.slice();
    next.splice(index, 1);
    itemsBox.value = next;
    await emitState();
  }

  async function pop(): Promise<void> {
    await remove(itemsBox.value.length - 1);
  }

  async function replace(index: number, input: Value | ItemField): Promise<void> {
    if (!hasIndex(itemsBox.value, index)) {
      await insert(index, input);
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

    await emitState();
  }

  async function move(from: number, to: number): Promise<void> {
    if (!hasIndex(itemsBox.value, from)) {
      return;
    }

    const safeTo = clampIndex(to, 0, itemsBox.value.length - 1);
    const next = itemsBox.value.slice();
    const [field] = next.splice(from, 1);
    next.splice(safeTo, 0, field);
    itemsBox.value = next;
    await emitState();
  }

  async function swap(first: number, second: number): Promise<void> {
    if (!hasIndex(itemsBox.value, first) || !hasIndex(itemsBox.value, second)) {
      return;
    }

    const next = itemsBox.value.slice();
    [next[first], next[second]] = [next[second], next[first]];
    itemsBox.value = next;
    await emitState();
  }

  async function clear(): Promise<void> {
    itemsBox.value = [];
    innerErrorBox.value = null;
    outerErrorBox.value = null;
    await emitState();
  }

  async function setInnerErrors(nextErrors: ArrayFieldErrors<FieldErrors<ItemField>>): Promise<void> {
    if (Array.isArray(nextErrors)) {
      innerErrorBox.value = null;
      await Promise.all(
        itemsBox.value.map((field, index) =>
          normalizeField(field).setInnerErrors((nextErrors as readonly unknown[])[index]),
        ),
      );
    } else {
      innerErrorBox.value = nextErrors as FieldError;
    }

    await errorsChanged(readStoreSnapshot(errors));
  }

  async function setOuterErrors(nextErrors: ArrayFieldErrors<FieldErrors<ItemField>>): Promise<void> {
    if (Array.isArray(nextErrors)) {
      outerErrorBox.value = null;
      await Promise.all(
        itemsBox.value.map((field, index) =>
          normalizeField(field).setOuterErrors((nextErrors as readonly unknown[])[index]),
        ),
      );
    } else {
      outerErrorBox.value = nextErrors as FieldError;
    }

    await errorsChanged(readStoreSnapshot(errors));
  }

  async function clearInnerErrors(): Promise<void> {
    innerErrorBox.value = null;
    await Promise.all(itemsBox.value.map((field) => normalizeField(field).clearInnerErrors()));
    await errorsChanged(readStoreSnapshot(errors));
  }

  async function clearOuterErrors(): Promise<void> {
    outerErrorBox.value = null;
    await Promise.all(itemsBox.value.map((field) => normalizeField(field).clearOuterErrors()));
    await errorsChanged(readStoreSnapshot(errors));
  }

  async function runValidation(strategy: ValidationRunReason): Promise<void> {
    const scope = requireCurrentScope();
    validationController?.abort();
    const controller = new AbortController();
    const version = ++validationVersion;
    validationController = controller;
    scoped(scope, () => {
      validationPendingBox.value = true;
    });

    const dependencies = new Set<AnyStore>();
    const ctx = createValidationContext({ path: [], signal: controller.signal, dependencies, scope });

    try {
      await scoped(scope, () =>
        Promise.all(itemsBox.value.map((field) => normalizeField(field).validate())),
      );
      const nextError = await runFieldValidators(validators, scoped(scope, () => read()), ctx);

      if (version !== validationVersion || controller.signal.aborted) {
        return;
      }

      await scoped(scope, async () => {
        innerErrorBox.value = (Array.isArray(nextError) ? null : nextError) as FieldError;
        if (Array.isArray(nextError)) {
          await setInnerErrors(nextError as ArrayFieldErrors<FieldErrors<ItemField>>);
        }
        dependencyTracker.update(scope, dependencies);

        await Promise.all([
          errorsChanged(readStoreSnapshot(errors)),
          readStoreSnapshot(isValid) ? validated(read()) : validationFailed(read()),
        ]);
      });
    } finally {
      if (version === validationVersion) {
        scoped(scope, () => {
          validationPendingBox.value = false;
        });
      }
    }

    void strategy;
  }

  const validate = createEventMethod<void>("arrayField.validate", async () => {
    await runValidation("manual");
  });

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
    fill,
    reset,
    setInnerErrors,
    setOuterErrors,
    clearInnerErrors,
    clearOuterErrors,
    push,
    unshift,
    insert,
    remove,
    pop,
    replace,
    move,
    swap,
    clear,
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
    return isFieldContract(input) ? (input as ItemField) : createItem(input as Value, index);
  }
}
