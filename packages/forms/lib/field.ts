import { computed, event, reaction, scoped, store } from "@virentia/core";
import type {
  CreateFieldOptions,
  Field,
  FieldError,
  ValidationEffect,
  ValidationFunction,
} from "./types";
import {
  createEventMethod,
  createValidationContext,
  createValidationDependencyTracker,
  emptyFields,
  hasErrors,
  readStoreSnapshot,
  requireCurrentScope,
  runFieldValidators,
  toArray,
  type AnyStore,
  type ValidationRunReason,
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
  const validationPendingBox = store(false);
  const validators = toArray(options.validate);
  const strategies = new Set(options.validationStrategies ?? []);

  const state = computed(() => valueBox.value);
  const innerError = computed(() => innerErrorBox.value);
  const outerError = computed(() => outerErrorBox.value);
  const error = computed(() => outerErrorBox.value ?? innerErrorBox.value);
  const meta = computed(() => metaBox.value);
  const isFocused = computed(() => focusedBox.value);
  const isValid = computed(() => error.value === null);
  const isValidationPending = computed(() => validationPendingBox.value);

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
  const dependencyTracker = createValidationDependencyTracker(() => runValidation("dependency"));
  let validationController: AbortController | null = null;
  let validationVersion = 0;

  async function fill(next: Value): Promise<void> {
    valueBox.value = next;
    await changed(next);

    if (strategies.has("change")) {
      await validate();
    }
  }

  async function reset(): Promise<void> {
    valueBox.value = initial;
    innerErrorBox.value = null;
    outerErrorBox.value = initialOuterError;
    metaBox.value = initialMeta;
    focusedBox.value = false;
    await Promise.all([changed(initial), errorsChanged(readStoreSnapshot(error))]);
  }

  async function setInnerErrors(errorValue: FieldError): Promise<void> {
    innerErrorBox.value = errorValue;
    await errorsChanged(readStoreSnapshot(error));
  }

  async function setOuterErrors(errorValue: FieldError): Promise<void> {
    outerErrorBox.value = errorValue;
    await errorsChanged(readStoreSnapshot(error));
  }

  async function clearInnerErrors(): Promise<void> {
    await setInnerErrors(null);
  }

  async function clearOuterErrors(): Promise<void> {
    await setOuterErrors(null);
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
    const ctx = createValidationContext({
      path: [],
      signal: controller.signal,
      dependencies,
      scope,
    });

    try {
      const nextError = await runFieldValidators(validators, scoped(scope, () => read()), ctx);

      if (version !== validationVersion || controller.signal.aborted) {
        return;
      }

      await scoped(scope, async () => {
        innerErrorBox.value = nextError;
        dependencyTracker.update(scope, dependencies);

        const nextValue = read();
        await Promise.all([
          errorsChanged(readStoreSnapshot(error)),
          hasErrors(nextError) ? validationFailed(nextValue) : validated(nextValue),
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

  const validate = createEventMethod<void>("field.validate", async () => {
    await runValidation("manual");
  });

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
    fill,
    changed,
    focus,
    focused,
    blur,
    blurred,
    changeError,
    setInnerError,
    setOuterError,
    errorsChanged,
    setInnerErrors,
    setOuterErrors,
    clearInnerErrors,
    clearOuterErrors,
    changeMeta,
    reset,
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
    on: change,
    run(next) {
      const currentScope = requireCurrentScope();

      void scoped(currentScope, () => fill(next));
    },
  });
  reaction({
    on: focus,
    run() {
      focusedBox.value = true;
      void focused();

      if (strategies.has("focus")) {
        const currentScope = requireCurrentScope();

        void scoped(currentScope, () => validate());
      }
    },
  });
  reaction({
    on: blur,
    run() {
      focusedBox.value = false;
      void blurred();

      if (strategies.has("blur")) {
        const currentScope = requireCurrentScope();

        void scoped(currentScope, () => validate());
      }
    },
  });
  reaction({
    on: changeError,
    run(errorValue) {
      const currentScope = requireCurrentScope();

      void scoped(currentScope, () => setOuterErrors(errorValue));
    },
  });
  reaction({
    on: setInnerError,
    run(errorValue) {
      const currentScope = requireCurrentScope();

      void scoped(currentScope, () => setInnerErrors(errorValue));
    },
  });
  reaction({
    on: setOuterError,
    run(errorValue) {
      const currentScope = requireCurrentScope();

      void scoped(currentScope, () => setOuterErrors(errorValue));
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
