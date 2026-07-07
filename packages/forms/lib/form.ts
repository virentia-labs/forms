import { computed, effect, event, reaction, reactive, scoped, scope as createScope } from "@virentia/core";
import { createField } from "./field";
import {
  applyErrorsToSchemaFx,
  attachSchemaChangeValidation,
  clearSchemaErrorsFx,
  cloneSnapshot,
  createValidationContext,
  createValidationDependencyTracker,
  deepEqual,
  fillSchemaFx,
  hasErrors,
  ignoreAbort,
  isFieldContract,
  isPlainObject,
  pickSchema,
  readSchemaErrors,
  readSchemaValues,
  readStoreSnapshot,
  resetSchemaFx,
  runFormValidators,
  schemaIsPending,
  toArray,
  validateSchemaFx,
  type AnyRecord,
  type AnyStore,
} from "./shared";
import type {
  CreateFormConfig,
  Form,
  FormProjection,
  NormalizeSchema,
  PartialRecursive,
  PickSchema,
  SchemaErrors,
  SchemaValues,
  SelectionShape,
  ValidationEffect,
  ValidationFunction,
} from "./types";

type FunctionFormValidationConfig<
  Schema extends AnyRecord,
  Values = SchemaValues<Schema>,
> = Omit<CreateFormConfig<Schema, Values>, "validation"> & {
  validation?:
    | ValidationFunction<Values, PartialRecursive<SchemaErrors<Schema>>>
    | readonly ValidationFunction<Values, PartialRecursive<SchemaErrors<Schema>>>[];
};

type EffectFormValidationConfig<
  Schema extends AnyRecord,
  Values = SchemaValues<Schema>,
> = Omit<CreateFormConfig<Schema, Values>, "validation"> & {
  validation?:
    | ValidationEffect<Values, PartialRecursive<SchemaErrors<Schema>>>
    | readonly ValidationEffect<Values, PartialRecursive<SchemaErrors<Schema>>>[];
};

export function createForm<Schema extends AnyRecord>(
  config: FunctionFormValidationConfig<Schema>,
): Form<Schema>;
export function createForm<Schema extends AnyRecord>(
  config: EffectFormValidationConfig<Schema>,
): Form<Schema>;
export function createForm<Schema extends AnyRecord>(
  config: CreateFormConfig<Schema>,
): Form<Schema>;
export function createForm<Schema extends AnyRecord>(
  config: CreateFormConfig<Schema>,
): Form<Schema> {
  const fields = normalizeSchema(config.schema) as NormalizeSchema<Schema>;
  const validators = toArray(config.validation);
  const strategies = new Set(config.validationStrategies ?? []);
  const initialSnapshot = scoped(createScope(), () =>
    cloneSnapshot(readSchemaValues(fields) as SchemaValues<Schema>),
  );
  const snapshotBox = reactive<{ initialized: boolean; value: SchemaValues<Schema> | null }>({
    initialized: true,
    value: initialSnapshot,
  });
  const values = computed(() => readSchemaValues(fields) as SchemaValues<Schema>);
  const value = values;
  const innerErrors = computed(() => readSchemaErrors(fields, "innerErrors") as SchemaErrors<Schema>);
  const outerErrors = computed(() => readSchemaErrors(fields, "outerErrors") as SchemaErrors<Schema>);
  const errors = computed(() => readSchemaErrors(fields, "errors") as SchemaErrors<Schema>);
  const snapshot = computed(() =>
    snapshotBox.initialized ? (snapshotBox.value as SchemaValues<Schema>) : readStoreSnapshot(values),
  );
  const isChanged = computed(() => !deepEqual(readStoreSnapshot(values), readStoreSnapshot(snapshot)));
  const isValid = computed(() => !hasErrors(readStoreSnapshot(errors)));
  const filled = event<SchemaValues<Schema>>("form.filled");
  const changed = event<SchemaValues<Schema>>("form.changed");
  const errorsChanged = event<SchemaErrors<Schema>>("form.errorsChanged");
  const validated = event<SchemaValues<Schema>>("form.validated");
  const validationFailed = event<SchemaValues<Schema>>("form.validationFailed");
  const submitted = event<SchemaValues<Schema>>("form.submitted");
  const validatedAndSubmitted = event<SchemaValues<Schema>>("form.validatedAndSubmitted");

  // Every side effect that touches units or scope runs as an effect: the kernel
  // keeps `ctx.scope` active across each `await`, and `ctx.signal` supersedes a
  // stale validation run. Nothing reads or writes a store outside an
  // effect/reaction, so the work stays bound to the dispatch scope.
  const validateFx = effect<void, void>(async (_payload, { scope, signal }) => {
    const dependencies = new Set<AnyStore>();
    const ctx = createValidationContext({ path: [], signal, dependencies, scope });

    await clearSchemaErrorsFx({ schema: fields, channel: "inner" });
    errorsChanged(readStoreSnapshot(errors));

    await validateSchemaFx(fields);

    const nextErrors = await runFormValidators(validators, readStoreSnapshot(values), ctx);

    if (signal.aborted) {
      return;
    }

    if (nextErrors) {
      await applyErrorsToSchemaFx({ schema: fields, errors: nextErrors as AnyRecord, channel: "inner" });
    }

    dependencyTracker.update(scope, dependencies);
    const nextValues = readStoreSnapshot(values);

    errorsChanged(readStoreSnapshot(errors));

    if (readStoreSnapshot(isValid)) {
      validated(nextValues);
    } else {
      validationFailed(nextValues);
    }
  }, "form.validate.effect");

  // `validate` is a plain event; the reaction below runs validation. Revalidating
  // is re-dispatching it — a direct unit await, no `async` wrapper.
  const validate = event<void>("form.validate");
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
  const isValidationPending = computed(() => validateFx.pending.value || schemaIsPending(fields));

  const fillFx = effect<
    { values?: PartialRecursive<SchemaValues<Schema>>; errors?: PartialRecursive<SchemaErrors<Schema>> },
    void
  >(async (payload) => {
    if (payload.values) {
      await fillSchemaFx({ schema: fields, values: payload.values as AnyRecord });
    }

    if (payload.errors) {
      await applyErrorsToSchemaFx({ schema: fields, errors: payload.errors as AnyRecord, channel: "outer" });
    }

    // Dispatch every event in one synchronous block (no `await` between calls):
    // the scope is live for all of them, and there is no second suspension point
    // to lose it at — unlike awaiting them one by one after the child work above.
    const nextValues = readStoreSnapshot(values);
    filled(nextValues);
    changed(nextValues);
    errorsChanged(readStoreSnapshot(errors));

    if (strategies.has("change")) {
      await validate();
    }
  }, "form.fill.effect");

  const resetFx = effect<void, void>(async () => {
    await resetSchemaFx(fields);
    snapshotBox.initialized = true;
    snapshotBox.value = cloneSnapshot(initialSnapshot);
    changed(readStoreSnapshot(values));
    errorsChanged(readStoreSnapshot(errors));
  }, "form.reset.effect");

  const clearOuterErrorsFx = effect<void, void>(async () => {
    await clearSchemaErrorsFx({ schema: fields, channel: "outer" });
    errorsChanged(readStoreSnapshot(errors));
  }, "form.clearOuterErrors.effect");

  const clearInnerErrorsFx = effect<void, void>(async () => {
    await clearSchemaErrorsFx({ schema: fields, channel: "inner" });
    errorsChanged(readStoreSnapshot(errors));
  }, "form.clearInnerErrors.effect");

  const forceUpdateSnapshotFx = effect<void, void>(async () => {
    snapshotBox.initialized = true;
    snapshotBox.value = cloneSnapshot(readStoreSnapshot(values));
  }, "form.forceUpdateSnapshot.effect");

  const persistFx = effect<
    { values: PartialRecursive<SchemaValues<Schema>>; errors?: PartialRecursive<SchemaErrors<Schema>> },
    void
  >(async (payload) => {
    await fillFx({ values: payload.values, errors: payload.errors });
    await forceUpdateSnapshotFx();
  }, "form.persist.effect");

  const submit = event<void>("form.submit");
  reaction({
    on: submit,
    async run() {
      submitted(readStoreSnapshot(values));
      await validate();

      if (readStoreSnapshot(isValid)) {
        await forceUpdateSnapshotFx();
        validatedAndSubmitted(readStoreSnapshot(values));
      }
    },
  });

  const form: Form<Schema> = {
    kind: "form",
    fields,
    values,
    value,
    errors,
    innerErrors,
    outerErrors,
    snapshot,
    isChanged,
    isValid,
    isValidationPending,
    filled,
    changed,
    errorsChanged,
    validate,
    validated,
    validationFailed,
    submit,
    submitted,
    validatedAndSubmitted,
    fill: fillFx,
    reset: resetFx,
    clearOuterErrors: () => clearOuterErrorsFx(),
    clearInnerErrors: () => clearInnerErrorsFx(),
    forceUpdateSnapshot: () => forceUpdateSnapshotFx(),
    pick(selection) {
      return createForm({
        schema: pickSchema(fields, selection as AnyRecord),
        validationStrategies: config.validationStrategies,
      }) as FormProjection<PickSchema<NormalizeSchema<Schema>, typeof selection>>;
    },
    serialize() {
      return { values: readStoreSnapshot(values), errors: readStoreSnapshot(errors) };
    },
    persist: persistFx,
    read() {
      return readStoreSnapshot(values);
    },
  };

  if (strategies.has("change")) {
    attachSchemaChangeValidation(fields, () => validate());
  }

  return form;
}

function normalizeSchema<Schema extends AnyRecord>(schema: Schema): NormalizeSchema<Schema> {
  const result: AnyRecord = {};

  for (const [key, value] of Object.entries(schema)) {
    if (isFieldContract(value)) {
      result[key] = value;
    } else if (isPlainObject(value)) {
      result[key] = normalizeSchema(value);
    } else {
      result[key] = createField(value);
    }
  }

  return result as NormalizeSchema<Schema>;
}
