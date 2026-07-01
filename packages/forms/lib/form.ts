import { computed, event, reactive, scoped, scope as createScope, store } from "@virentia/core";
import { createField } from "./field";
import {
  applyErrorsToSchema,
  attachSchemaChangeValidation,
  clearSchemaErrors,
  cloneSnapshot,
  createEventMethod,
  createValidationContext,
  createValidationDependencyTracker,
  deepEqual,
  fillSchema,
  hasErrors,
  isFieldContract,
  isPlainObject,
  pickSchema,
  readSchemaErrors,
  readSchemaValues,
  readStoreSnapshot,
  requireCurrentScope,
  resetSchema,
  runFormValidators,
  schemaIsPending,
  toArray,
  validateSchema,
  type AnyRecord,
  type AnyStore,
  type ValidationRunReason,
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
  const formPendingBox = store(false);
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
  const isValidationPending = computed(() => formPendingBox.value || schemaIsPending(fields));
  const filled = event<SchemaValues<Schema>>("form.filled");
  const changed = event<SchemaValues<Schema>>("form.changed");
  const errorsChanged = event<SchemaErrors<Schema>>("form.errorsChanged");
  const validated = event<SchemaValues<Schema>>("form.validated");
  const validationFailed = event<SchemaValues<Schema>>("form.validationFailed");
  const submitted = event<SchemaValues<Schema>>("form.submitted");
  const validatedAndSubmitted = event<SchemaValues<Schema>>("form.validatedAndSubmitted");
  const dependencyTracker = createValidationDependencyTracker(() => runValidation("dependency"));
  let validationController: AbortController | null = null;
  let validationVersion = 0;

  async function fill(payload: {
    values?: PartialRecursive<SchemaValues<Schema>>;
    errors?: PartialRecursive<SchemaErrors<Schema>>;
  }): Promise<void> {
    const scope = requireCurrentScope();

    if (payload.values) {
      await fillSchema(fields, payload.values as AnyRecord);
    }

    if (payload.errors) {
      await applyErrorsToSchema(fields, payload.errors as AnyRecord, "outer");
    }

    const nextValues = scoped(scope, () => readStoreSnapshot(values));
    await scoped(scope, () =>
      Promise.all([
        filled(nextValues),
        changed(nextValues),
        errorsChanged(readStoreSnapshot(errors)),
      ]),
    );

    if (strategies.has("change")) {
      await validate();
    }
  }

  async function reset(): Promise<void> {
    const scope = requireCurrentScope();

    await resetSchema(fields);
    scoped(scope, () => {
      snapshotBox.initialized = true;
      snapshotBox.value = cloneSnapshot(initialSnapshot);
    });
    await scoped(scope, () =>
      Promise.all([changed(readStoreSnapshot(values)), errorsChanged(readStoreSnapshot(errors))]),
    );
  }

  async function clearOuterErrors(): Promise<void> {
    const scope = requireCurrentScope();

    await clearSchemaErrors(fields, "outer");
    await scoped(scope, () => errorsChanged(readStoreSnapshot(errors)));
  }

  async function clearInnerErrors(): Promise<void> {
    const scope = requireCurrentScope();

    await clearSchemaErrors(fields, "inner");
    await scoped(scope, () => errorsChanged(readStoreSnapshot(errors)));
  }

  async function forceUpdateSnapshot(): Promise<void> {
    const scope = requireCurrentScope();

    scoped(scope, () => {
      snapshotBox.initialized = true;
      snapshotBox.value = cloneSnapshot(readStoreSnapshot(values));
    });
  }

  async function runValidation(strategy: ValidationRunReason): Promise<void> {
    const scope = requireCurrentScope();
    validationController?.abort();
    const controller = new AbortController();
    const version = ++validationVersion;
    validationController = controller;
    scoped(scope, () => {
      formPendingBox.value = true;
    });

    const dependencies = new Set<AnyStore>();
    const ctx = createValidationContext({ path: [], signal: controller.signal, dependencies, scope });

    try {
      await scoped(scope, () => clearInnerErrors());
      await scoped(scope, () => validateSchema(fields));
      const nextErrors = await runFormValidators(
        validators,
        scoped(scope, () => readStoreSnapshot(values)),
        ctx,
      );

      if (version !== validationVersion || controller.signal.aborted) {
        return;
      }

      await scoped(scope, async () => {
        if (nextErrors) {
          await applyErrorsToSchema(fields, nextErrors as AnyRecord, "inner");
        }

        dependencyTracker.update(scope, dependencies);
        const nextValues = readStoreSnapshot(values);
        const valid = readStoreSnapshot(isValid);
        await Promise.all([
          errorsChanged(readStoreSnapshot(errors)),
          valid ? validated(nextValues) : validationFailed(nextValues),
        ]);
      });
    } finally {
      if (version === validationVersion) {
        scoped(scope, () => {
          formPendingBox.value = false;
        });
      }
    }

    void strategy;
  }

  const validate = createEventMethod<void>("form.validate", async () => {
    await runValidation("manual");
  });

  const submit = createEventMethod<void>("form.submit", async () => {
    const nextValues = readStoreSnapshot(values);
    await submitted(nextValues);
    await runValidation("submit");

    if (readStoreSnapshot(isValid)) {
      await forceUpdateSnapshot();
      await validatedAndSubmitted(readStoreSnapshot(values));
    }
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
    fill,
    reset,
    clearOuterErrors,
    clearInnerErrors,
    forceUpdateSnapshot,
    pick(selection) {
      return createForm({
        schema: pickSchema(fields, selection as AnyRecord),
        validationStrategies: config.validationStrategies,
      }) as FormProjection<PickSchema<NormalizeSchema<Schema>, typeof selection>>;
    },
    serialize() {
      return { values: readStoreSnapshot(values), errors: readStoreSnapshot(errors) };
    },
    async persist(payload) {
      await fill({ values: payload.values, errors: payload.errors });
      await forceUpdateSnapshot();
    },
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
