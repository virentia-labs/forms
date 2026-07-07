import { computed, effect, event, reaction, scoped, store } from "@virentia/core";
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
  const valueBox = store(initial);
  const initialMeta = (options.meta ?? {}) as Meta;
  const initialOuterError = options.error ?? null;
  const innerErrorBox = store<FieldError>(null);
  const outerErrorBox = store<FieldError>(initialOuterError);
  const focusedBox = store(false);
  const metaBox = store(initialMeta);
  const validators = toArray(options.validate);
  const strategies = new Set(options.validationStrategies ?? []);

  const state = computed(() => valueBox.value);
  const innerError = computed(() => innerErrorBox.value);
  const outerError = computed(() => outerErrorBox.value);
  const error = computed(() => outerErrorBox.value ?? innerErrorBox.value);
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

  // Every side effect that touches units or scope is an effect: the kernel keeps
  // `ctx.scope` active across each `await`, and `ctx.signal` aborts the run when a
  // newer one starts (cancel-previous / stale-result handling). Reactions await
  // these effects, so the work stays bound to the dispatch scope instead of
  // escaping it as detached fire-and-forget.
  const validateFx = effect<void, void>(async (_payload, { scope, signal }) => {
    const dependencies = new Set<AnyStore>();
    const ctx = createValidationContext({ path: [], signal, dependencies, scope });

    // Run the whole body inside `scope`. The validators are plain-async (they await
    // user code — an external boundary — which may suspend for several ticks, e.g.
    // an async schema parse), and after that await the ambient scope is no longer
    // guaranteed (it may be the base scope when a dependency-tracker reaction
    // re-runs us detached). A leaf field's tail only writes stores and emits (no
    // nested effects), so a single `scoped(scope, async …)` is safe here and keeps
    // every write bound to `scope` in every path.
    await scoped(scope, async () => {
      const nextError = await runFieldValidators(validators, read(), ctx);

      if (signal.aborted) {
        return;
      }

      innerErrorBox.value = nextError;
      dependencyTracker.update(scope, dependencies);

      const nextValue = read();
      errorsChanged(readStoreSnapshot(error));

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
    valueBox.value = initial;
    innerErrorBox.value = null;
    outerErrorBox.value = initialOuterError;
    metaBox.value = initialMeta;
    focusedBox.value = false;
    changed(initial);
    errorsChanged(readStoreSnapshot(error));
  }, "field.reset.effect");

  const setInnerErrorsFx = effect<FieldError, void>(async (errorValue) => {
    innerErrorBox.value = errorValue;
    errorsChanged(readStoreSnapshot(error));
  }, "field.setInnerErrors.effect");

  const setOuterErrorsFx = effect<FieldError, void>(async (errorValue) => {
    outerErrorBox.value = errorValue;
    errorsChanged(readStoreSnapshot(error));
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

  return field;

  function read(): Value {
    return valueBox.value;
  }
}
