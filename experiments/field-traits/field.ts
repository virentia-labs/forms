// Experimental implementation. It is deliberately not exported by the package.
import { computed, effect, event, reaction, scoped, store } from "@virentia/core";
import { nativeModel, nativeTrait } from "@virentia/core/internal";
import type { CreateFieldOptions, Field, FieldError, FieldValidator, ValidationEffect, ValidationFunction } from "../../packages/forms/lib/types";
import { createValidationContext, createValidationDependencyTracker, emptyFields, hasErrors, ignoreAbort, readStoreSnapshot, runFieldValidators, toArray, type AnyStore } from "../../packages/forms/lib/shared";

interface Configuration {
  initial: unknown;
  meta: object;
  error: FieldError;
  validators: readonly FieldValidator<unknown>[];
  strategies: ReadonlySet<string>;
}

const ValueState = nativeTrait<Configuration>()({
  setup(_self, config) {
    const valueBox = store(config.initial);
    const metaBox = store(config.meta);
    const focusedBox = store(false);
    const changed = event<unknown>("field.changed");
    const changeMeta = event<object>("field.changeMeta");
    reaction({ on: changeMeta, run(next) { metaBox.value = next; } });
    return {
      valueBox, focusedBox, changed, changeMeta,
      state: computed(() => valueBox.value),
      meta: computed(() => metaBox.value),
      isFocused: computed(() => focusedBox.value),
      read: () => valueBox.value,
      restoreState() {
        valueBox.value = config.initial;
        metaBox.value = config.meta;
        focusedBox.value = false;
      },
    };
  },
});

const Validatable = nativeTrait<Configuration, { read(): unknown }>()({
  requires: ["read"],
  setup(self, config) {
    const read = self.read;
    const innerErrorBox = store<FieldError>(null);
    const outerErrorBox = store<FieldError>(config.error);
    const innerError = computed(() => innerErrorBox.value);
    const outerError = computed(() => outerErrorBox.value);
    const readError = () => outerErrorBox.value ?? innerErrorBox.value;
    const error = computed(readError);
    const errorsChanged = event<FieldError>("field.errorsChanged");
    const validated = event<unknown>("field.validated");
    const validationFailed = event<unknown>("field.validationFailed");
    const validateFx = effect<void, void>(async (_payload, { scope: app, signal }) => {
      const dependencies = new Set<AnyStore>();
      const ctx = createValidationContext({ path: [], signal, dependencies, scope: app });
      const nextError = await scoped(app, () => runFieldValidators(config.validators, read(), ctx));
      if (signal.aborted) return;
      scoped(app, () => {
        innerErrorBox.value = nextError;
        dependencyTracker.update(app, dependencies);
        const value = read();
        errorsChanged(readError());
        if (hasErrors(nextError)) validationFailed(value);
        else validated(value);
      });
    }, "field.validate.effect");
    const validate = event<void>("field.validate");
    const dependencyTracker = createValidationDependencyTracker(validate);
    reaction({ on: validate, async run() {
      validateFx.abort();
      try { await validateFx(); } catch (error) { ignoreAbort(error); }
    } });
    const setInnerErrors = effect<FieldError, void>(async value => {
      innerErrorBox.value = value;
      errorsChanged(readError());
    }, "field.setInnerErrors.effect");
    const setOuterErrors = effect<FieldError, void>(async value => {
      outerErrorBox.value = value;
      errorsChanged(readError());
    }, "field.setOuterErrors.effect");
    const changeError = event<FieldError>("field.changeError");
    const setInnerError = event<FieldError>("field.setInnerError");
    const setOuterError = event<FieldError>("field.setOuterError");
    reaction({ on: changeError, async run(value) { await setOuterErrors(value); } });
    reaction({ on: setInnerError, async run(value) { await setInnerErrors(value); } });
    reaction({ on: setOuterError, async run(value) { await setOuterErrors(value); } });
    return {
      error, innerError, outerError, readError,
      isValid: computed(() => error.value === null),
      isValidationPending: validateFx.pending,
      errorsChanged, validated, validationFailed, validate,
      changeError, setInnerError, setOuterError, setInnerErrors, setOuterErrors,
      clearInnerErrors: () => setInnerErrors(null),
      clearOuterErrors: () => setOuterErrors(null),
      restoreErrors() { innerErrorBox.value = null; outerErrorBox.value = config.error; },
    };
  },
});

// Traits are flattened once; unit declarations run only for a real field.
const ScalarField = nativeModel<Configuration>()({
  with: [ValueState, Validatable],
  setup(self, config) {
    const valueBox = self.valueBox, focusedBox = self.focusedBox;
    const read = self.read, readError = self.readError;
    const changed = self.changed, errorsChanged = self.errorsChanged, validate = self.validate;
    const restoreState = self.restoreState, restoreErrors = self.restoreErrors;
    const fill = effect<unknown, void>(async next => {
      valueBox.value = next;
      changed(next);
      if (config.strategies.has("change")) await validate();
    }, "field.fill.effect");
    const reset = effect<void, void>(async () => {
      restoreState(); restoreErrors();
      changed(read()); errorsChanged(readError());
    }, "field.reset.effect");
    const change = event<unknown>("field.change");
    const focus = event<void>("field.focus"), focused = event<void>("field.focused");
    const blur = event<void>("field.blur"), blurred = event<void>("field.blurred");
    reaction({ on: change, async run(next) { await fill(next); } });
    reaction({ on: focus, async run() {
      focusedBox.value = true; focused();
      if (config.strategies.has("focus")) await validate();
    } });
    reaction({ on: blur, async run() {
      focusedBox.value = false; blurred();
      if (config.strategies.has("blur")) await validate();
    } });
    return { fill, reset, change, focus, focused, blur, blurred };
  },
});

type FunctionOptions<Value, Meta extends object> = Omit<CreateFieldOptions<Value, Meta>, "validate"> & {
  validate?: ValidationFunction<Value, FieldError> | readonly ValidationFunction<Value, FieldError>[];
};
type EffectOptions<Value, Meta extends object> = Omit<CreateFieldOptions<Value, Meta>, "validate"> & {
  validate?: ValidationEffect<Value, FieldError> | readonly ValidationEffect<Value, FieldError>[];
};

export function createField<Value, Meta extends object = Record<string, never>>(initial: Value, options?: FunctionOptions<Value, Meta>): Field<Value, Meta>;
export function createField<Value, Meta extends object = Record<string, never>>(initial: Value, options?: EffectOptions<Value, Meta>): Field<Value, Meta>;
export function createField<Value, Meta extends object = Record<string, never>>(initial: Value, options?: CreateFieldOptions<Value, Meta>): Field<Value, Meta>;
export function createField<Value, Meta extends object = Record<string, never>>(initial: Value, options: CreateFieldOptions<Value, Meta> = {}): Field<Value, Meta> {
  const config: Configuration = {
    initial, meta: options.meta ?? {}, error: options.error ?? null,
    validators: toArray(options.validate), strategies: new Set(options.validationStrategies ?? []),
  };
  const graph = ScalarField(config);
  // The public serializer only needs these units. Capturing graph here would
  // retain the temporary composition table and its constructor-only input.
  const read = graph.read, error = graph.error;
  return {
    kind: "field", state: graph.state,
    error: graph.error, innerError: graph.innerError, outerError: graph.outerError,
    errors: graph.error, innerErrors: graph.innerError, outerErrors: graph.outerError,
    meta: graph.meta, isValid: graph.isValid, isFocused: graph.isFocused,
    isValidationPending: graph.isValidationPending,
    change: graph.change, fill: graph.fill, changed: graph.changed,
    focus: graph.focus, focused: graph.focused, blur: graph.blur, blurred: graph.blurred,
    changeError: graph.changeError, setInnerError: graph.setInnerError, setOuterError: graph.setOuterError,
    errorsChanged: graph.errorsChanged, setInnerErrors: graph.setInnerErrors, setOuterErrors: graph.setOuterErrors,
    clearInnerErrors: graph.clearInnerErrors, clearOuterErrors: graph.clearOuterErrors,
    changeMeta: graph.changeMeta, reset: graph.reset, validate: graph.validate,
    validated: graph.validated, validationFailed: graph.validationFailed,
    read, readFields: emptyFields,
    serialize: () => ({ value: read(), errors: readStoreSnapshot(error) }),
  } as unknown as Field<Value, Meta>;
}
