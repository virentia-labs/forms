import { computed, event, scoped, store } from "@virentia/core";
import { createField } from "./field";
import {
  applyErrorsToSchema,
  createEventMethod,
  createValidationContext,
  createValidationDependencyTracker,
  hasErrors,
  isFieldContract,
  normalizeField,
  readObjectErrors,
  readObjectValues,
  readStoreSnapshot,
  requireCurrentScope,
  runFormValidators,
  toArray,
  type AnyStore,
  type ValidationRunReason,
} from "./shared";
import type {
  AnyField,
  CreateShapeFieldOptions,
  ShapeErrors,
  ShapeField,
  ShapeValues,
} from "./types";

export function createShapeField<Shape extends Record<string, AnyField>>(
  initial: Shape,
  options?: CreateShapeFieldOptions,
): ShapeField<Shape>;
export function createShapeField<Values extends Record<string, unknown>>(
  initial: Values,
  options: CreateShapeFieldOptions,
): ShapeField<Record<keyof Values & string, AnyField>>;
export function createShapeField(
  initial: Record<string, unknown>,
  options: CreateShapeFieldOptions = {},
): ShapeField<Record<string, AnyField>> {
  const initialFields = normalizeShapeInput(initial, options);
  const fieldsBox = store(initialFields);
  const validators = toArray(options.validate);
  const strategies = new Set(options.validationStrategies ?? []);
  const validationPendingBox = store(false);
  const fields = computed(() => fieldsBox.value as Readonly<Record<string, AnyField>>);
  const state = computed(() => readObjectValues(fieldsBox.value) as ShapeValues<Record<string, AnyField>>);
  const innerErrors = computed(
    () => readObjectErrors(fieldsBox.value, "innerErrors") as ShapeErrors<Record<string, AnyField>>,
  );
  const outerErrors = computed(
    () => readObjectErrors(fieldsBox.value, "outerErrors") as ShapeErrors<Record<string, AnyField>>,
  );
  const ownInnerErrorsBox = store<Record<string, unknown> | null>(null);
  const errors = computed(
    () =>
      (ownInnerErrorsBox.value ?? readObjectErrors(fieldsBox.value, "errors")) as ShapeErrors<
        Record<string, AnyField>
      >,
  );
  const isValid = computed(
    () =>
      !hasErrors(ownInnerErrorsBox.value) &&
      Object.values(fieldsBox.value).every((field) => readStoreSnapshot(normalizeField(field).isValid)),
  );
  const isValidationPending = computed(
    () =>
      validationPendingBox.value ||
      Object.values(fieldsBox.value).some((field) =>
        readStoreSnapshot(normalizeField(field).isValidationPending),
      ),
  );
  const changed = event<Record<string, unknown>>("shapeField.changed");
  const errorsChanged = event<Record<string, unknown>>("shapeField.errorsChanged");
  const validated = event<Record<string, unknown>>("shapeField.validated");
  const validationFailed = event<Record<string, unknown>>("shapeField.validationFailed");
  const dependencyTracker = createValidationDependencyTracker(() => runValidation("dependency"));
  let validationController: AbortController | null = null;
  let validationVersion = 0;

  async function emitState(): Promise<void> {
    await Promise.all([changed(read()), errorsChanged(readStoreSnapshot(errors))]);
  }

  async function fill(nextValues: Record<string, unknown>): Promise<void> {
    const nextFields = { ...fieldsBox.value };
    const work: Promise<void>[] = [];

    for (const [key, value] of Object.entries(nextValues)) {
      const field = nextFields[key];

      if (field) {
        work.push(normalizeField(field).fill(value));
      } else {
        nextFields[key] = createShapeChild(key, value, options);
      }
    }

    fieldsBox.value = nextFields;
    await Promise.all(work);
    await emitState();

    if (strategies.has("change")) {
      await validate();
    }
  }

  async function reset(): Promise<void> {
    fieldsBox.value = { ...initialFields };
    ownInnerErrorsBox.value = null;
    await Promise.all(Object.values(fieldsBox.value).map((field) => normalizeField(field).reset()));
    await emitState();
  }

  async function add(payload: { key: string; field: AnyField }): Promise<void> {
    fieldsBox.value = { ...fieldsBox.value, [payload.key]: payload.field };
    await emitState();
  }

  async function remove(key: string): Promise<void> {
    if (!(key in fieldsBox.value)) {
      return;
    }

    const { [key]: _removed, ...next } = fieldsBox.value;
    fieldsBox.value = next;
    await emitState();
  }

  async function replace(payload: { key: string; field: AnyField }): Promise<void> {
    fieldsBox.value = { ...fieldsBox.value, [payload.key]: payload.field };
    await emitState();
  }

  async function clear(): Promise<void> {
    fieldsBox.value = {};
    ownInnerErrorsBox.value = null;
    await emitState();
  }

  async function setInnerErrors(nextErrors: Record<string, unknown>): Promise<void> {
    ownInnerErrorsBox.value = null;
    await applyErrorsToSchema(fieldsBox.value, nextErrors, "inner");
    await errorsChanged(readStoreSnapshot(errors));
  }

  async function setOuterErrors(nextErrors: Record<string, unknown>): Promise<void> {
    await applyErrorsToSchema(fieldsBox.value, nextErrors, "outer");
    await errorsChanged(readStoreSnapshot(errors));
  }

  async function clearInnerErrors(): Promise<void> {
    ownInnerErrorsBox.value = null;
    await Promise.all(Object.values(fieldsBox.value).map((field) => normalizeField(field).clearInnerErrors()));
    await errorsChanged(readStoreSnapshot(errors));
  }

  async function clearOuterErrors(): Promise<void> {
    await Promise.all(Object.values(fieldsBox.value).map((field) => normalizeField(field).clearOuterErrors()));
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
        Promise.all(Object.values(fieldsBox.value).map((field) => normalizeField(field).validate())),
      );
      const nextErrors = await runFormValidators(validators, scoped(scope, () => read()), ctx);

      if (version !== validationVersion || controller.signal.aborted) {
        return;
      }

      await scoped(scope, async () => {
        ownInnerErrorsBox.value = nextErrors as Record<string, unknown> | null;
        if (nextErrors && typeof nextErrors === "object") {
          await setInnerErrors(nextErrors as Record<string, unknown>);
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

  const validate = createEventMethod<void>("shapeField.validate", async () => {
    await runValidation("manual");
  });

  return {
    kind: "shape",
    fields,
    state,
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
    add,
    remove,
    replace,
    clear,
    read,
    readFields() {
      return fieldsBox.value;
    },
    serialize() {
      return { value: read(), errors: readStoreSnapshot(errors) as ShapeErrors<Record<string, AnyField>> };
    },
  };

  function read(): Record<string, unknown> {
    return readObjectValues(fieldsBox.value);
  }
}

function normalizeShapeInput(
  input: Record<string, unknown>,
  options: CreateShapeFieldOptions,
): Record<string, AnyField> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      isFieldContract(value) ? value : createShapeChild(key, value, options),
    ]),
  );
}

function createShapeChild(key: string, value: unknown, options: CreateShapeFieldOptions): AnyField {
  return options.createField ? options.createField(key, value) : createField(value);
}
