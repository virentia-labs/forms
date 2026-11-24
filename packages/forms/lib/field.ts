import { computed, effect, event, reaction, scoped, store } from "@virentia/core";
import { fieldRevision, fieldState, type FieldCell } from "./field-state";
import { getModelSetupContext } from "@virentia/core/internal";
import type {
  CreateFieldOptions,
  Field,
  FieldError,
  ValidationEffect,
  ValidationFunction,
} from "./types";
import {
  createValidationContext,
  createValidationDependencyTracker,
  emptyFields,
  hasErrors,
  ignoreAbort,
  readStoreSnapshot,
  modelFieldValue,
  runFieldValidators,
  toArray,
  type AnyStore,
} from "./shared";

type FunctionFieldValidationOptions<Value, Meta extends object> = Omit<
  CreateFieldOptions<Value, Meta>,
  "validate"
> & {
  validate?:
    | ValidationFunction<Value, FieldError>
    | readonly ValidationFunction<Value, FieldError>[];
};

type EffectFieldValidationOptions<Value, Meta extends object> = Omit<
  CreateFieldOptions<Value, Meta>,
  "validate"
> & {
  validate?:
    | ValidationEffect<Value, FieldError>
    | readonly ValidationEffect<Value, FieldError>[];
};

export function createField<Value, Meta extends object = Record<string, never>>(
  initial: Value,
  options?: FunctionFieldValidationOptions<Value, Meta>,
): Field<Value, Meta>;
export function createField<Value, Meta extends object = Record<string, never>>(
  initial: Value,
  options?: EffectFieldValidationOptions<Value, Meta>,
): Field<Value, Meta>;
export function createField<Value, Meta extends object = Record<string, never>>(
  initial: Value,
  options?: CreateFieldOptions<Value, Meta>,
): Field<Value, Meta>;
export function createField<Value, Meta extends object = Record<string, never>>(
  initial: Value,
  options: CreateFieldOptions<Value, Meta> = {},
): Field<Value, Meta> {
  const cells = fieldState();
  const valueBox = (cells?.value as FieldCell<Value> | undefined) ?? store(initial);
  const initialMeta = (options.meta ?? {}) as Meta;
  const initialOuterError = options.error ?? null;
  cells?.captureDefaults?.(initial, initialMeta, initialOuterError);
  const innerErrorBox = cells?.innerError ?? store<FieldError>(null);
  const outerErrorBox = cells?.outerError ?? store<FieldError>(initialOuterError);
  const focusedBox = cells?.focused ?? store(false);
  const metaBox = (cells?.meta as FieldCell<Meta> | undefined) ?? store(initialMeta);
  const validators = toArray(options.validate);
  const strategies = new Set(options.validationStrategies ?? []);

  const state = computed(() => valueBox.value);
  const innerError = computed(() => innerErrorBox.value);
  const outerError = computed(() => outerErrorBox.value);
  const readError = () => outerErrorBox.value ?? innerErrorBox.value;
  const error = computed(readError);
  const meta = computed(() => metaBox.value);
  const isFocused = computed(() => focusedBox.value);
  const isValid = computed(() => error.value === null);

  const change = event<Value>("field.change");
  const changed = event<Value>("field.changed");
  const focus = event<void>("field.focus");
  const focused = event<void>("field.focused");
  const blur = event<void>("field.blur");
  const blurred = event<void>("field.blurred");
  const changeError = event<FieldError>("field.changeError");
  const setInnerError = event<FieldError>("field.setInnerError");
  const setOuterError = event<FieldError>("field.setOuterError");
  const errorsChanged = event<FieldError>("field.errorsChanged");
  const changeMeta = event<Meta>("field.changeMeta");
  const validated = event<Value>("field.validated");
  const validationFailed = event<Value>("field.validationFailed");

  // Effects carry direct unit awaits and cancellation. A user validator's native
  // promise is a separate boundary, so its synchronous commit re-enters scope.
  const validateFx = effect<void, void>(async (_payload, { scope, signal }) => {
    const dependencies = new Set<AnyStore>();
    const ctx = createValidationContext({ path: [], signal, dependencies, scope });

    const nextError = await scoped(scope, () => runFieldValidators(validators, read(), ctx));
    if (signal.aborted) return;
    // A user validator can suspend outside the kernel. Re-enter only for the
    // synchronous commit; never retain an ambient scope across its promise.
    scoped(scope, () => {
      innerErrorBox.value = nextError;
      dependencyTracker.update(scope, dependencies);

      const nextValue = read();
      errorsChanged(readError());

      if (hasErrors(nextError)) {
        validationFailed(nextValue);
      } else {
        validated(nextValue);
      }
    });
  }, "field.validate.effect");

  // `validate` is a plain event; the reaction below runs validation. Revalidating
  // is just re-dispatching it, so every trigger is a direct unit await and there
  // is no `async` wrapper (which would drop the ambient scope).
  const validate = event<void>("field.validate");
  const dependencyTracker = createValidationDependencyTracker(validate);
  const isValidationPending = validateFx.pending;

  const fillFx = effect<Value, void>(async (next) => {
    valueBox.value = next;
    changed(next);

    if (strategies.has("change")) {
      await validate();
    }
  }, "field.fill.effect");

  const resetFx = effect<void, void>(async () => {
    const initialValue = cells ? cells.initialValue.value : initial;
    valueBox.value = initialValue;
    innerErrorBox.value = null;
    outerErrorBox.value = cells ? cells.initialOuterError.value : initialOuterError;
    metaBox.value = (cells ? cells.initialMeta.value : initialMeta) as Meta;
    focusedBox.value = false;
    changed(initialValue);
    errorsChanged(readError());
  }, "field.reset.effect");

  const setInnerErrorsFx = effect<FieldError, void>(async (errorValue) => {
    innerErrorBox.value = errorValue;
    errorsChanged(readError());
  }, "field.setInnerErrors.effect");

  const setOuterErrorsFx = effect<FieldError, void>(async (errorValue) => {
    outerErrorBox.value = errorValue;
    errorsChanged(readError());
  }, "field.setOuterErrors.effect");

  const field: Field<Value, Meta> = {
    kind: "field",
    state,
    error,
    innerError,
    outerError,
    errors: error,
    innerErrors: innerError,
    outerErrors: outerError,
    meta,
    isValid,
    isFocused,
    isValidationPending,
    change,
    fill: fillFx,
    changed,
    focus,
    focused,
    blur,
    blurred,
    changeError,
    setInnerError,
    setOuterError,
    errorsChanged,
    setInnerErrors: setInnerErrorsFx,
    setOuterErrors: setOuterErrorsFx,
    clearInnerErrors: () => setInnerErrorsFx(null),
    clearOuterErrors: () => setOuterErrorsFx(null),
    changeMeta,
    reset: resetFx,
    validate,
    validated,
    validationFailed,
    read,
    readFields: emptyFields,
    serialize() {
      return { value: read(), errors: readStoreSnapshot(error) };
    },
  };

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
  reaction({
    on: change,
    async run(next) {
      await fillFx(next);
    },
  });
  reaction({
    on: focus,
    async run() {
      focusedBox.value = true;
      focused();

      if (strategies.has("focus")) {
        await validate();
      }
    },
  });
  reaction({
    on: blur,
    async run() {
      focusedBox.value = false;
      blurred();

      if (strategies.has("blur")) {
        await validate();
      }
    },
  });
  reaction({
    on: changeError,
    async run(errorValue) {
      await setOuterErrorsFx(errorValue);
    },
  });
  reaction({
    on: setInnerError,
    async run(errorValue) {
      await setInnerErrorsFx(errorValue);
    },
  });
  reaction({
    on: setOuterError,
    async run(errorValue) {
      await setOuterErrorsFx(errorValue);
    },
  });
  reaction({
    on: changeMeta,
    run(next) {
      metaBox.value = next;
    },
  });

  if (getModelSetupContext()) {
    const revision = cells?.revision ?? store(0);
    reaction({ on: changed, run() { revision.value++; } });
    Object.defineProperty(field, fieldRevision, { value: revision });
  }
  return modelFieldValue(field);

  function read(): Value {
    return valueBox.value;
  }
}
