import { computed, effect, event, reaction, store } from "@virentia/core";
import { createField } from "./field";
import {
  applyErrorsToSchemaFx,
  createValidationContext,
  createValidationDependencyTracker,
  hasErrors,
  ignoreAbort,
  isFieldContract,
  normalizeField,
  readObjectErrors,
  readObjectValues,
  readStoreSnapshot,
  runFormValidators,
  toArray,
  type AnyStore,
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
  const changed = event<Record<string, unknown>>("shapeField.changed");
  const errorsChanged = event<Record<string, unknown>>("shapeField.errorsChanged");
  const validated = event<Record<string, unknown>>("shapeField.validated");
  const validationFailed = event<Record<string, unknown>>("shapeField.validationFailed");

  // Effects await units one at a time in imperative order — never `Promise.all`,
  // never through an intermediate `async` helper or `.catch` that ends on an
  // effect await — so the kernel keeps this effect's scope alive across each
  // await. Schema traversal collects synchronous thunks; the effect awaits them
  // one by one.
  const validateFx = effect<void, void>(async (_payload, { scope, signal }) => {
    const dependencies = new Set<AnyStore>();
    const ctx = createValidationContext({ path: [], signal, dependencies, scope });

    for (const child of Object.values(fieldsBox.value)) {
      await normalizeField(child).validate();
    }

    const nextErrors = await runFormValidators(validators, read(), ctx);

    if (signal.aborted) {
      return;
    }

    if (nextErrors && typeof nextErrors === "object") {
      ownInnerErrorsBox.value = null;
      await applyErrorsToSchemaFx({ schema: fieldsBox.value, errors: nextErrors as Record<string, unknown>, channel: "inner" });
    } else {
      ownInnerErrorsBox.value = (nextErrors ?? null) as Record<string, unknown> | null;
    }

    dependencyTracker.update(scope, dependencies);

    errorsChanged(readStoreSnapshot(errors));

    if (readStoreSnapshot(isValid)) {
      validated(read());
    } else {
      validationFailed(read());
    }
  }, "shapeField.validate.effect");

  // `validate` is a plain event; the reaction below runs validation. Revalidating
  // is re-dispatching it — a direct unit await, no `async` wrapper.
  const validate = event<void>("shapeField.validate");
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
      Object.values(fieldsBox.value).some((field) =>
        readStoreSnapshot(normalizeField(field).isValidationPending),
      ),
  );

  const fillFx = effect<Record<string, unknown>, void>(async (nextValues) => {
    const nextFields = { ...fieldsBox.value };
    const fills: Array<() => Promise<void>> = [];

    for (const [key, value] of Object.entries(nextValues)) {
      const field = nextFields[key];

      if (field) {
        const normalized = normalizeField(field);
        fills.push(() => normalized.fill(value));
      } else {
        nextFields[key] = createShapeChild(key, value, options);
      }
    }

    fieldsBox.value = nextFields;

    for (const fill of fills) {
      await fill();
    }

    changed(read());
    errorsChanged(readStoreSnapshot(errors));

    if (strategies.has("change")) {
      await validate();
    }
  }, "shapeField.fill.effect");

  const resetFx = effect<void, void>(async () => {
    fieldsBox.value = { ...initialFields };
    ownInnerErrorsBox.value = null;

    for (const field of Object.values(fieldsBox.value)) {
      await normalizeField(field).reset();
    }

    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "shapeField.reset.effect");

  const addFx = effect<{ key: string; field: AnyField }, void>(async (payload) => {
    fieldsBox.value = { ...fieldsBox.value, [payload.key]: payload.field };
    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "shapeField.add.effect");

  const removeFx = effect<string, void>(async (key) => {
    if (!(key in fieldsBox.value)) {
      return;
    }

    const { [key]: _removed, ...next } = fieldsBox.value;
    fieldsBox.value = next;
    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "shapeField.remove.effect");

  const replaceFx = effect<{ key: string; field: AnyField }, void>(async (payload) => {
    fieldsBox.value = { ...fieldsBox.value, [payload.key]: payload.field };
    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "shapeField.replace.effect");

  const clearFx = effect<void, void>(async () => {
    fieldsBox.value = {};
    ownInnerErrorsBox.value = null;
    changed(read());
    errorsChanged(readStoreSnapshot(errors));
  }, "shapeField.clear.effect");

  const setInnerErrorsFx = effect<Record<string, unknown>, void>(async (nextErrors) => {
    ownInnerErrorsBox.value = null;
    await applyErrorsToSchemaFx({ schema: fieldsBox.value, errors: nextErrors, channel: "inner" });
    errorsChanged(readStoreSnapshot(errors));
  }, "shapeField.setInnerErrors.effect");

  const setOuterErrorsFx = effect<Record<string, unknown>, void>(async (nextErrors) => {
    await applyErrorsToSchemaFx({ schema: fieldsBox.value, errors: nextErrors, channel: "outer" });
    errorsChanged(readStoreSnapshot(errors));
  }, "shapeField.setOuterErrors.effect");

  const clearInnerErrorsFx = effect<void, void>(async () => {
    ownInnerErrorsBox.value = null;
    for (const field of Object.values(fieldsBox.value)) {
      await normalizeField(field).clearInnerErrors();
    }
    errorsChanged(readStoreSnapshot(errors));
  }, "shapeField.clearInnerErrors.effect");

  const clearOuterErrorsFx = effect<void, void>(async () => {
    for (const field of Object.values(fieldsBox.value)) {
      await normalizeField(field).clearOuterErrors();
    }
    errorsChanged(readStoreSnapshot(errors));
  }, "shapeField.clearOuterErrors.effect");

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
    fill: fillFx,
    reset: resetFx,
    setInnerErrors: setInnerErrorsFx,
    setOuterErrors: setOuterErrorsFx,
    clearInnerErrors: () => clearInnerErrorsFx(),
    clearOuterErrors: () => clearOuterErrorsFx(),
    add: addFx,
    remove: removeFx,
    replace: replaceFx,
    clear: () => clearFx(),
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
