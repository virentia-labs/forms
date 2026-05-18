import {
  computed,
  event,
  getCurrentScope,
  reaction,
  scope as createScope,
  scoped,
  store,
  type Event,
  type EventCallable,
  type Effect,
  type Scope,
  type Store,
  type StoreWritable,
} from "@virentia/core";

export type MaybePromise<T> = T | Promise<T>;
export type FieldError = string | null;
export type ValidationStrategy = "change" | "blur" | "focus" | "submit" | "manual";
type ValidationRunReason = ValidationStrategy | "dependency";
export type PartialRecursive<T> = T extends readonly (infer Item)[]
  ? readonly PartialRecursive<Item>[]
  : T extends object
    ? { [Key in keyof T]?: PartialRecursive<T[Key]> }
    : T;

type AnyStore<T = any> = Store<T> | StoreWritable<T>;
type PayloadArgs<T> = undefined extends T ? [payload?: T] : [payload: T];
type AnyRecord = Record<string, any>;

export interface ValidationContext {
  readonly signal: AbortSignal;
  readonly path: readonly string[];
  read<T>(unit: Store<T> | StoreWritable<T>): T;
}

export type ValidationResult<Errors> = Errors | null | undefined;

export interface ValidationPayload<Value> {
  readonly value: Value;
  readonly ctx: ValidationContext;
}

export type ValidationFunction<Value, Errors = FieldError> = (
  value: Value,
  ctx: ValidationContext,
) => MaybePromise<ValidationResult<Errors>>;

export type ValidationEffect<Value, Errors = FieldError> = Effect<
  ValidationPayload<Value>,
  ValidationResult<Errors>,
  unknown
>;

export type ValidationUnit<Value, Errors = FieldError> =
  | ValidationFunction<Value, Errors>
  | ValidationEffect<Value, Errors>;

export type FieldValidator<Value, Errors = FieldError> = ValidationUnit<Value, Errors>;

export type FormValidator<Values, Errors = AnyRecord> = ValidationUnit<Values, Errors>;

export interface FieldContract<Value, Errors = FieldError, Fill = Value> {
  readonly kind: string;
  readonly state: Store<Value>;
  readonly errors?: Store<Errors>;
  readonly innerErrors?: Store<Errors>;
  readonly outerErrors?: Store<Errors>;
  readonly isValid?: Store<boolean>;
  readonly isValidationPending?: Store<boolean>;
  readonly changed?: Event<Value>;
  readonly errorsChanged?: Event<Errors>;
  readonly validate?: EventCallable<void>;
  readonly validated?: Event<Value>;
  readonly validationFailed?: Event<Value>;
  fill(payload: Fill): Promise<void>;
  reset(): Promise<void>;
  setInnerErrors?(errors: Errors): Promise<void>;
  setOuterErrors?(errors: Errors): Promise<void>;
  clearInnerErrors?(): Promise<void>;
  clearOuterErrors?(): Promise<void>;
  serialize?(): { value: Value; errors: Errors };
  read?(): Value;
  readFields?(): Readonly<Record<string, AnyField>>;
  readonly fields?: Store<any> | Readonly<Record<string, AnyField>>;
  readonly view?: unknown;
}

export type AnyField = FieldContract<any, any, any>;

export interface NormalizedField<Value = unknown, Errors = unknown, Fill = unknown>
  extends FieldContract<Value, Errors, Fill> {
  readonly errors: Store<Errors>;
  readonly innerErrors: Store<Errors>;
  readonly outerErrors: Store<Errors>;
  readonly isValid: Store<boolean>;
  readonly isValidationPending: Store<boolean>;
  readonly changed: Event<Value>;
  readonly errorsChanged: Event<Errors>;
  readonly validate: EventCallable<void>;
  readonly validated: Event<Value>;
  readonly validationFailed: Event<Value>;
  setInnerErrors(errors: Errors): Promise<void>;
  setOuterErrors(errors: Errors): Promise<void>;
  clearInnerErrors(): Promise<void>;
  clearOuterErrors(): Promise<void>;
  read(): Value;
  readFields(): Readonly<Record<string, AnyField>>;
}

export interface Field<Value, Meta extends object = Record<string, never>>
  extends NormalizedField<Value, FieldError, Value> {
  readonly error: Store<FieldError>;
  readonly innerError: Store<FieldError>;
  readonly outerError: Store<FieldError>;
  readonly meta: Store<Meta>;
  readonly isFocused: Store<boolean>;
  readonly change: EventCallable<Value>;
  readonly focus: EventCallable<void>;
  readonly focused: Event<void>;
  readonly blur: EventCallable<void>;
  readonly blurred: Event<void>;
  readonly changeError: EventCallable<FieldError>;
  readonly setInnerError: EventCallable<FieldError>;
  readonly setOuterError: EventCallable<FieldError>;
  readonly changeMeta: EventCallable<Meta>;
}

export interface CreateFieldOptions<Value, Meta extends object = Record<string, never>> {
  error?: FieldError;
  meta?: Meta;
  validate?: FieldValidator<any, FieldError> | readonly FieldValidator<any, FieldError>[];
  validationStrategies?: readonly ValidationStrategy[];
}

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

export type ArrayFieldErrors<ItemErrors = FieldError> = FieldError | readonly ItemErrors[];

export interface ArrayField<Value, ItemField extends AnyField = Field<Value>>
  extends NormalizedField<readonly Value[], ArrayFieldErrors<FieldErrors<ItemField>>, readonly Value[]> {
  readonly items: Store<readonly ItemField[]>;
  readonly itemFields: Store<Readonly<Record<string, ItemField>>>;
  readonly length: Store<number>;
  push(value: Value | ItemField): Promise<void>;
  unshift(value: Value | ItemField): Promise<void>;
  insert(index: number, value: Value | ItemField): Promise<void>;
  remove(index: number): Promise<void>;
  pop(): Promise<void>;
  replace(index: number, value: Value | ItemField): Promise<void>;
  move(from: number, to: number): Promise<void>;
  swap(first: number, second: number): Promise<void>;
  clear(): Promise<void>;
}

export interface CreateArrayFieldOptions<Value, ItemField extends AnyField = Field<Value>> {
  createItem?(value: Value, index: number): ItemField;
  validate?:
    | FieldValidator<readonly Value[], ArrayFieldErrors<FieldErrors<ItemField>>>
    | readonly FieldValidator<readonly Value[], ArrayFieldErrors<FieldErrors<ItemField>>>[];
  validationStrategies?: readonly ValidationStrategy[];
}

export interface ShapeField<Shape extends Record<string, AnyField> = Record<string, AnyField>>
  extends NormalizedField<ShapeValues<Shape>, ShapeErrors<Shape>, PartialRecursive<ShapeValues<Shape>>> {
  readonly fields: Store<Readonly<Record<string, AnyField>>>;
  add<Key extends string, FieldValue extends AnyField>(
    payload: { key: Key; field: FieldValue },
  ): Promise<void>;
  remove(key: keyof Shape | string): Promise<void>;
  replace<Key extends string, FieldValue extends AnyField>(
    payload: { key: Key; field: FieldValue },
  ): Promise<void>;
  clear(): Promise<void>;
}

export interface CreateShapeFieldOptions {
  createField?(key: string, value: unknown): AnyField;
  validationStrategies?: readonly ValidationStrategy[];
  validate?:
    | FieldValidator<Record<string, unknown>, Record<string, unknown>>
    | readonly FieldValidator<Record<string, unknown>, Record<string, unknown>>[];
}

export type FieldValue<T> = T extends FieldContract<infer Value, any, any>
  ? Value
  : T extends readonly any[]
    ? T
    : T extends Date
      ? T
      : T extends object
        ? { [Key in keyof T]: FieldValue<T[Key]> }
        : T;

export type FieldErrors<T> = T extends FieldContract<any, infer Errors, any>
  ? Errors
  : T extends readonly any[]
    ? FieldError
    : T extends Date
      ? FieldError
      : T extends object
        ? { [Key in keyof T]: FieldErrors<T[Key]> }
        : FieldError;

export type SchemaValues<Schema> = { [Key in keyof Schema]: FieldValue<Schema[Key]> };
export type SchemaErrors<Schema> = { [Key in keyof Schema]: FieldErrors<Schema[Key]> };
export type ShapeValues<Shape extends Record<string, AnyField>> = {
  [Key in keyof Shape]: FieldValue<Shape[Key]>;
};
export type ShapeErrors<Shape extends Record<string, AnyField>> = {
  [Key in keyof Shape]: FieldErrors<Shape[Key]>;
};

export interface CreateFormConfig<Schema extends AnyRecord, Values = SchemaValues<Schema>> {
  schema: Schema;
  validation?:
    | FormValidator<any, any>
    | readonly FormValidator<any, any>[];
  validationStrategies?: readonly ValidationStrategy[];
}

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

export interface Form<Schema extends AnyRecord = AnyRecord, Values = SchemaValues<Schema>, Errors = SchemaErrors<Schema>> {
  readonly kind: "form";
  readonly fields: NormalizeSchema<Schema>;
  readonly values: Store<Values>;
  readonly value: Store<Values>;
  readonly errors: Store<Errors>;
  readonly innerErrors: Store<Errors>;
  readonly outerErrors: Store<Errors>;
  readonly snapshot: Store<Values>;
  readonly isChanged: Store<boolean>;
  readonly isValid: Store<boolean>;
  readonly isValidationPending: Store<boolean>;
  readonly filled: Event<Values>;
  readonly changed: Event<Values>;
  readonly errorsChanged: Event<Errors>;
  readonly validate: EventCallable<void>;
  readonly validated: Event<Values>;
  readonly validationFailed: Event<Values>;
  readonly submit: EventCallable<void>;
  readonly submitted: Event<Values>;
  readonly validatedAndSubmitted: Event<Values>;
  fill(payload: { values?: PartialRecursive<Values>; errors?: PartialRecursive<Errors> }): Promise<void>;
  reset(): Promise<void>;
  clearOuterErrors(): Promise<void>;
  clearInnerErrors(): Promise<void>;
  forceUpdateSnapshot(): Promise<void>;
  pick<Selection extends SelectionShape<NormalizeSchema<Schema>>>(
    selection: Selection,
  ): FormProjection<PickSchema<NormalizeSchema<Schema>, Selection>>;
  serialize(): { values: Values; errors: Errors };
  persist(payload: { values: PartialRecursive<Values>; errors?: PartialRecursive<Errors> }): Promise<void>;
  read(): Values;
}

export type AnyForm = Form<any, any, any>;

export type NormalizeSchema<Schema> = {
  [Key in keyof Schema]: Schema[Key] extends FieldContract<any, any, any>
    ? Schema[Key]
    : Schema[Key] extends readonly any[]
      ? Field<Schema[Key]>
      : Schema[Key] extends Date
        ? Field<Schema[Key]>
        : Schema[Key] extends object
          ? NormalizeSchema<Schema[Key]>
          : Field<Schema[Key]>;
};

export type SelectionShape<Schema> = {
  [Key in keyof Schema]?: Schema[Key] extends FieldContract<any, any, any>
    ? true
    : true | SelectionShape<Schema[Key]>;
};

export type PickSchema<Schema, Selection> = {
  [Key in keyof Selection & keyof Schema]: Selection[Key] extends true
    ? Schema[Key]
    : Schema[Key] extends AnyRecord
      ? PickSchema<Schema[Key], Selection[Key]>
      : Schema[Key];
};

export type FormProjection<Schema extends AnyRecord> = Form<Schema>;

export interface WizardStep<Id extends string = string, StepForm extends AnyForm = AnyForm> {
  readonly id: Id;
  readonly form: StepForm;
  readonly title?: string;
  readonly when?: (ctx: WizardWhenContext) => boolean;
}

export interface WizardWhenContext {
  readonly values: unknown;
}

export interface CreateWizardConfig<Steps extends readonly WizardStep[], RootForm extends AnyForm | undefined = undefined> {
  form?: RootForm;
  steps: Steps;
}

export interface Wizard<Steps extends readonly WizardStep[] = readonly WizardStep[], RootForm extends AnyForm | undefined = AnyForm | undefined> {
  readonly kind: "wizard";
  readonly form: RootForm;
  readonly steps: Store<Steps>;
  readonly visibleSteps: Store<Steps>;
  readonly currentId: Store<Steps[number]["id"]>;
  readonly currentIndex: Store<number>;
  readonly currentStep: Store<Steps[number]>;
  readonly currentForm: Store<Steps[number]["form"]>;
  readonly visitedIds: Store<readonly Steps[number]["id"][]>;
  readonly completedIds: Store<readonly Steps[number]["id"][]>;
  readonly canGoBack: Store<boolean>;
  readonly canGoNext: Store<boolean>;
  readonly changed: Event<Steps[number]["id"]>;
  readonly completed: Event<unknown>;
  next(): Promise<boolean>;
  back(): Promise<boolean>;
  goTo(id: Steps[number]["id"]): Promise<boolean>;
  complete(): Promise<boolean>;
  reset(): Promise<void>;
  read(): unknown;
}

export interface FieldTypeExtension<BaseFactory extends (...args: any[]) => AnyField, NextFactory extends (...args: any[]) => AnyField> {
  kind?: string;
  create(base: BaseFactory, ...args: Parameters<NextFactory>): ReturnType<NextFactory>;
}

export type FieldType<Factory extends (...args: any[]) => AnyField> = Factory & {
  extend<Args extends any[], NextField extends AnyField>(
    extension: {
      kind?: string;
      create(base: Factory, ...args: Args): NextField;
    },
  ): FieldType<(...args: Args) => NextField>;
};

const normalizedFields = new WeakMap<object, NormalizedField<any, any, any>>();
const nativeStoreKeys = new Set<PropertyKey>([
  "node",
  "writable",
  "subscribe",
  "map",
  "filter",
  "filterMap",
]);

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
  const valueBox = store({ value: initial });
  const initialMeta = (options.meta ?? {}) as Meta;
  const initialOuterError = options.error ?? null;
  const innerErrorBox = store<FieldError>(null);
  const outerErrorBox = store<FieldError>(initialOuterError);
  const focusedBox = store(false);
  const metaBox = store({ value: initialMeta });
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

export function createArrayField<Value, ItemField extends AnyField = Field<Value>>(
  initial: readonly Value[] = [],
  options: CreateArrayFieldOptions<Value, ItemField> = {},
): ArrayField<Value, ItemField> {
  const createItem = options.createItem ?? ((value: Value) => createField(value) as unknown as ItemField);
  const validators = toArray(options.validate);
  const strategies = new Set(options.validationStrategies ?? []);
  const itemsBox = store({ value: initial.map((value, index) => createItem(value, index)) });
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
  const fieldsBox = store({ value: initialFields });
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
  const snapshotBox = store<{ initialized: boolean; value: SchemaValues<Schema> | null }>({
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

export function step<Id extends string, StepForm extends AnyForm>(
  id: Id,
  config: Omit<WizardStep<Id, StepForm>, "id">,
): WizardStep<Id, StepForm> {
  return { id, ...config };
}

export function createWizard<Steps extends readonly WizardStep[], RootForm extends AnyForm | undefined = undefined>(
  config: CreateWizardConfig<Steps, RootForm>,
): Wizard<Steps, RootForm> {
  if (config.steps.length === 0) {
    throw new Error("Wizard requires at least one step");
  }

  const stepsBox = store({ value: config.steps });
  const currentIdBox = store({ value: config.steps[0].id });
  const visitedBox = store({ value: [config.steps[0].id] as readonly Steps[number]["id"][] });
  const completedBox = store({ value: [] as readonly Steps[number]["id"][] });
  const stepsStore = computed(() => stepsBox.value);
  const visibleSteps = computed(() => filterVisibleSteps(stepsBox.value) as Steps);
  const currentStep = computed(() => {
    const visible = readStoreSnapshot(visibleSteps);
    return visible.find((item) => item.id === currentIdBox.value) ?? visible[0] ?? stepsBox.value[0];
  });
  const currentId = computed(() => readStoreSnapshot(currentStep).id);
  const currentIndex = computed(() =>
    readStoreSnapshot(visibleSteps).findIndex((item) => item.id === readStoreSnapshot(currentId)),
  );
  const currentForm = computed(() => readStoreSnapshot(currentStep).form);
  const visitedIds = computed(() => visitedBox.value);
  const completedIds = computed(() => completedBox.value);
  const canGoBack = computed(() => readStoreSnapshot(currentIndex) > 0);
  const canGoNext = computed(() => readStoreSnapshot(currentIndex) < readStoreSnapshot(visibleSteps).length - 1);
  const changed = event<Steps[number]["id"]>("wizard.changed");
  const completed = event<unknown>("wizard.completed");

  async function next(): Promise<boolean> {
    const visible = readStoreSnapshot(visibleSteps);
    const index = readStoreSnapshot(currentIndex);

    if (index < 0 || index >= visible.length - 1) {
      return false;
    }

    const current = visible[index];
    const valid = await validateStep(current);

    if (!valid) {
      return false;
    }

    markCompleted(current.id);
    await setCurrent(visible[index + 1].id);
    return true;
  }

  async function back(): Promise<boolean> {
    const visible = readStoreSnapshot(visibleSteps);
    const index = readStoreSnapshot(currentIndex);

    if (index <= 0) {
      return false;
    }

    await setCurrent(visible[index - 1].id);
    return true;
  }

  async function goTo(id: Steps[number]["id"]): Promise<boolean> {
    const visible = readStoreSnapshot(visibleSteps);
    const currentIndexValue = readStoreSnapshot(currentIndex);
    const targetIndex = visible.findIndex((item) => item.id === id);

    if (targetIndex < 0) {
      return false;
    }

    if (targetIndex > currentIndexValue) {
      for (let index = currentIndexValue; index < targetIndex; index += 1) {
        const valid = await validateStep(visible[index]);

        if (!valid) {
          return false;
        }

        markCompleted(visible[index].id);
      }
    }

    await setCurrent(id);
    return true;
  }

  async function complete(): Promise<boolean> {
    for (const current of readStoreSnapshot(visibleSteps)) {
      const valid = await validateStep(current);

      if (!valid) {
        await setCurrent(current.id);
        return false;
      }

      markCompleted(current.id);
    }

    await completed(read());
    return true;
  }

  async function reset(): Promise<void> {
    if (config.form) {
      await config.form.reset();
    } else {
      await Promise.all(stepsBox.value.map((item) => item.form.reset()));
    }

    completedBox.value = [];
    visitedBox.value = [stepsBox.value[0].id];
    currentIdBox.value = stepsBox.value[0].id;
    await changed(currentIdBox.value);
  }

  return {
    kind: "wizard",
    form: config.form as RootForm,
    steps: stepsStore as Store<Steps>,
    visibleSteps: visibleSteps as Store<Steps>,
    currentId: currentId as Store<Steps[number]["id"]>,
    currentIndex,
    currentStep: currentStep as Store<Steps[number]>,
    currentForm: currentForm as Store<Steps[number]["form"]>,
    visitedIds,
    completedIds,
    canGoBack,
    canGoNext,
    changed,
    completed,
    next,
    back,
    goTo,
    complete,
    reset,
    read,
  };

  function filterVisibleSteps(steps: readonly WizardStep[]): readonly WizardStep[] {
    const values = config.form ? config.form.read() : undefined;

    return steps.filter((item) => !item.when || item.when({ values }));
  }

  async function validateStep(current: WizardStep): Promise<boolean> {
    await current.form.validate();
    return readStoreSnapshot(current.form.isValid);
  }

  async function setCurrent(id: Steps[number]["id"]): Promise<void> {
    currentIdBox.value = id;
    visitedBox.value = appendUnique(visitedBox.value, id);
    await changed(id);
  }

  function markCompleted(id: Steps[number]["id"]): void {
    completedBox.value = appendUnique(completedBox.value, id);
  }

  function read(): unknown {
    if (config.form) {
      return config.form.read();
    }

    return Object.fromEntries(stepsBox.value.map((item) => [item.id, item.form.read()]));
  }
}

export function createWizardForm<Schema extends AnyRecord, Steps extends readonly WizardStep[]>(
  config: CreateFormConfig<Schema> & { steps: (form: Form<Schema>) => Steps },
): Wizard<Steps, Form<Schema> & AnyForm> & { readonly form: Form<Schema> } {
  const form = createForm(config as any) as Form<Schema>;
  const wizard = createWizard({ form: form as Form<Schema> & AnyForm, steps: config.steps(form) });

  return Object.assign(wizard, { form });
}

export function defineField<FieldValue extends AnyField>(field: FieldValue): FieldValue {
  return field;
}

export function fieldType<Factory extends (...args: any[]) => AnyField>(config: {
  kind?: string;
  create: Factory;
}): FieldType<Factory> {
  return makeFieldType(config.create);
}

export function normalizeField<Value, Errors, Fill>(
  field: FieldContract<Value, Errors, Fill>,
): NormalizedField<Value, Errors, Fill> {
  const cached = normalizedFields.get(field as object);

  if (cached) {
    return cached as NormalizedField<Value, Errors, Fill>;
  }

  const readFields = () => readFieldChildren(field);
  const hasChildren = () => Object.keys(readFields()).length > 0;
  const emptyErrors = computed(() => null as Errors);
  const childrenErrors = computed(() => readObjectErrors(readFields(), "errors") as Errors);
  const childrenInnerErrors = computed(() => readObjectErrors(readFields(), "innerErrors") as Errors);
  const childrenOuterErrors = computed(() => readObjectErrors(readFields(), "outerErrors") as Errors);
  const errors = field.errors ?? (hasChildren() ? childrenErrors : emptyErrors);
  const innerErrors = field.innerErrors ?? (hasChildren() ? childrenInnerErrors : emptyErrors);
  const outerErrors = field.outerErrors ?? (hasChildren() ? childrenOuterErrors : emptyErrors);
  const changed = field.changed ?? event<Value>(`${field.kind}.changed`);
  const errorsChanged = field.errorsChanged ?? event<Errors>(`${field.kind}.errorsChanged`);
  const validated = field.validated ?? event<Value>(`${field.kind}.validated`);
  const validationFailed = field.validationFailed ?? event<Value>(`${field.kind}.validationFailed`);
  const isValid = field.isValid ?? computed(() => !hasErrors(readStoreSnapshot(errors)));
  const isValidationPending =
    field.isValidationPending ??
    computed(() =>
      Object.values(readFields()).some((child) =>
        readStoreSnapshot(normalizeField(child).isValidationPending),
      ),
    );
  const validate =
    field.validate ??
    createEventMethod<void>(`${field.kind}.validate`, async () => {
      await Promise.all(Object.values(readFields()).map((child) => normalizeField(child).validate()));
    });

  const normalized: NormalizedField<Value, Errors, Fill> = {
    ...field,
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
    async fill(payload: Fill) {
      if (field.fill) {
        await field.fill(payload);
        return;
      }

      await fillSchema(readFields(), payload as AnyRecord);
    },
    async reset() {
      if (field.reset) {
        await field.reset();
        return;
      }

      await resetSchema(readFields());
    },
    async setInnerErrors(nextErrors: Errors) {
      if (field.setInnerErrors) {
        await field.setInnerErrors(nextErrors);
        return;
      }

      await applyErrorsToSchema(readFields(), nextErrors as AnyRecord, "inner");
    },
    async setOuterErrors(nextErrors: Errors) {
      if (field.setOuterErrors) {
        await field.setOuterErrors(nextErrors);
        return;
      }

      await applyErrorsToSchema(readFields(), nextErrors as AnyRecord, "outer");
    },
    async clearInnerErrors() {
      if (field.clearInnerErrors) {
        await field.clearInnerErrors();
        return;
      }

      await clearSchemaErrors(readFields(), "inner");
    },
    async clearOuterErrors() {
      if (field.clearOuterErrors) {
        await field.clearOuterErrors();
        return;
      }

      await clearSchemaErrors(readFields(), "outer");
    },
    read() {
      if (field.read) {
        return field.read();
      }

      if (field.serialize) {
        return field.serialize().value;
      }

      return readStoreSnapshot(field.state);
    },
    readFields,
  };

  normalizedFields.set(field as object, normalized);
  return normalized;
}

export function readStoreSnapshot<T>(unit: Store<T> | StoreWritable<T>): T {
  const keys = Reflect.ownKeys(unit as object).filter((key) => !nativeStoreKeys.has(key));

  if (keys.length === 1 && keys[0] === "value") {
    return Reflect.get(unit as object, "value") as T;
  }

  if (isArrayStoreSnapshot(unit, keys)) {
    const length = Reflect.get(unit as object, "length") as number;
    return Array.from({ length }, (_item, index) => Reflect.get(unit as object, String(index))) as T;
  }

  return Object.fromEntries(keys.map((key) => [key, Reflect.get(unit as object, key)])) as T;
}

function makeFieldType<Factory extends (...args: any[]) => AnyField>(factory: Factory): FieldType<Factory> {
  const callable = ((...args: Parameters<Factory>) => factory(...args)) as FieldType<Factory>;

  callable.extend = ((extension: any) =>
    makeFieldType(((...args: any[]) => extension.create(callable, ...args)) as any)) as FieldType<Factory>["extend"];

  return callable;
}

function createEventMethod<T>(
  name: string,
  handler: (payload: T) => Promise<void>,
): EventCallable<T> {
  const signal = event<T>(name);
  const method = (async (...args: PayloadArgs<T>) => {
    const callScope = getCurrentScope();
    const payload = args[0] as T;
    await handler(payload);

    if (callScope) {
      await scoped(callScope, () => (signal as (...payload: PayloadArgs<T>) => Promise<void>)(...args));
      return;
    }

    await (signal as (...payload: PayloadArgs<T>) => Promise<void>)(...args);
  }) as EventCallable<T>;

  return Object.assign(method, signal);
}

function createValidationDependencyTracker(runAgain: () => Promise<void>) {
  const subscriptions = new WeakMap<Scope, () => void>();

  return {
    update(scope: Scope, dependencies: ReadonlySet<AnyStore>): void {
      subscriptions.get(scope)?.();

      if (dependencies.size === 0) {
        subscriptions.delete(scope);
        return;
      }

      const unsubscribers = [...dependencies].map((dependency) =>
        dependency.subscribe((_value: unknown, nextScope: Scope) => {
          if (nextScope !== scope) {
            return;
          }

          void scoped(scope, () => runAgain());
        }),
      );

      subscriptions.set(scope, () => {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      });
    },
  };
}

function createValidationContext(config: {
  path: readonly string[];
  signal: AbortSignal;
  dependencies: Set<AnyStore>;
  scope: Scope;
}): ValidationContext {
  return {
    path: config.path,
    signal: config.signal,
    read<T>(unit: Store<T> | StoreWritable<T>): T {
      config.dependencies.add(unit);
      return scoped(config.scope, () => readStoreSnapshot(unit));
    },
  };
}

async function runFieldValidators<Value, Errors>(
  validators: readonly FieldValidator<Value, Errors>[],
  value: Value,
  ctx: ValidationContext,
): Promise<Errors | null> {
  for (const validator of validators) {
    if (ctx.signal.aborted) {
      return null;
    }

    const error = await runValidationUnit(validator, value, ctx);

    if (error !== null && error !== undefined && hasErrors(error)) {
      return error;
    }
  }

  return null;
}

async function runFormValidators<Values, Errors>(
  validators: readonly FormValidator<Values, Errors>[],
  values: Values,
  ctx: ValidationContext,
): Promise<Errors | null> {
  for (const validator of validators) {
    if (ctx.signal.aborted) {
      return null;
    }

    const errors = await runValidationUnit(validator, values, ctx);

    if (errors !== null && errors !== undefined && hasErrors(errors)) {
      return errors;
    }
  }

  return null;
}

function runValidationUnit<Value, Errors>(
  validator: ValidationUnit<Value, Errors>,
  value: Value,
  ctx: ValidationContext,
): Promise<ValidationResult<Errors>> | MaybePromise<ValidationResult<Errors>> {
  if (isValidationEffect(validator)) {
    return validator({ value, ctx }, { signal: ctx.signal });
  }

  return validator(value, ctx);
}

function isValidationEffect<Value, Errors>(
  validator: ValidationUnit<Value, Errors>,
): validator is ValidationEffect<Value, Errors> {
  return Boolean(
    typeof validator === "function" &&
      "$pending" in validator &&
      "$inFlight" in validator &&
      "done" in validator &&
      "failed" in validator,
  );
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

function readSchemaValues(schema: AnyRecord): AnyRecord {
  return Object.fromEntries(
    Object.entries(schema).map(([key, fieldOrSchema]) => [
      key,
      isFieldContract(fieldOrSchema)
        ? normalizeField(fieldOrSchema).read()
        : readSchemaValues(fieldOrSchema),
    ]),
  );
}

function readSchemaErrors(schema: AnyRecord, channel: "errors" | "innerErrors" | "outerErrors"): AnyRecord {
  return Object.fromEntries(
    Object.entries(schema).map(([key, fieldOrSchema]) => [
      key,
      isFieldContract(fieldOrSchema)
        ? readStoreSnapshot(normalizeField(fieldOrSchema)[channel])
        : readSchemaErrors(fieldOrSchema, channel),
    ]),
  );
}

function readObjectValues(fields: Record<string, AnyField>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, normalizeField(field).read()]));
}

function readObjectErrors(
  fields: Record<string, AnyField>,
  channel: "errors" | "innerErrors" | "outerErrors",
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, readStoreSnapshot(normalizeField(field)[channel])]),
  );
}

function readArrayValue<Value>(items: readonly AnyField[]): readonly Value[] {
  return items.map((field) => normalizeField(field).read()) as readonly Value[];
}

function readArrayErrors(
  items: readonly AnyField[],
  channel: "errors" | "innerErrors" | "outerErrors",
): readonly unknown[] {
  return items.map((field) => readStoreSnapshot(normalizeField(field)[channel]));
}

async function fillSchema(schema: AnyRecord, values: AnyRecord): Promise<void> {
  await Promise.all(
    Object.entries(values).map(([key, value]) => {
      const fieldOrSchema = schema[key];

      if (!fieldOrSchema) {
        return undefined;
      }

      return isFieldContract(fieldOrSchema)
        ? normalizeField(fieldOrSchema).fill(value)
        : fillSchema(fieldOrSchema, value as AnyRecord);
    }),
  );
}

async function resetSchema(schema: AnyRecord): Promise<void> {
  await Promise.all(
    Object.values(schema).map((fieldOrSchema) =>
      isFieldContract(fieldOrSchema) ? normalizeField(fieldOrSchema).reset() : resetSchema(fieldOrSchema),
    ),
  );
}

async function validateSchema(schema: AnyRecord): Promise<void> {
  await Promise.all(
    Object.values(schema).map((fieldOrSchema) =>
      isFieldContract(fieldOrSchema) ? normalizeField(fieldOrSchema).validate() : validateSchema(fieldOrSchema),
    ),
  );
}

async function clearSchemaErrors(schema: AnyRecord, channel: "inner" | "outer"): Promise<void> {
  await Promise.all(
    Object.values(schema).map((fieldOrSchema) => {
      if (isFieldContract(fieldOrSchema)) {
        const field = normalizeField(fieldOrSchema);
        return channel === "inner" ? field.clearInnerErrors() : field.clearOuterErrors();
      }

      return clearSchemaErrors(fieldOrSchema, channel);
    }),
  );
}

async function applyErrorsToSchema(
  schema: AnyRecord,
  errors: AnyRecord,
  channel: "inner" | "outer",
): Promise<void> {
  const normalizedErrors = expandDottedPaths(errors);

  await Promise.all(
    Object.entries(normalizedErrors).map(([key, errorValue]) => {
      const fieldOrSchema = schema[key];

      if (!fieldOrSchema) {
        return undefined;
      }

      if (isFieldContract(fieldOrSchema)) {
        const field = normalizeField(fieldOrSchema);
        return channel === "inner" ? field.setInnerErrors(errorValue) : field.setOuterErrors(errorValue);
      }

      if (errorValue && typeof errorValue === "object") {
        return applyErrorsToSchema(fieldOrSchema, errorValue as AnyRecord, channel);
      }

      return undefined;
    }),
  );
}

function expandDottedPaths(input: AnyRecord): AnyRecord {
  const result: AnyRecord = {};

  for (const [key, value] of Object.entries(input)) {
    if (key.includes(".")) {
      setNestedPath(result, key.split("."), value);
    } else {
      const nextValue = isPlainObject(value) ? expandDottedPaths(value) : value;
      const previousValue = result[key];

      result[key] =
        isPlainObject(previousValue) && isPlainObject(nextValue)
          ? mergePlainObjects(previousValue, nextValue)
          : nextValue;
    }
  }

  return result;
}

function setNestedPath(target: AnyRecord, path: readonly string[], value: unknown): void {
  let cursor = target;

  for (let index = 0; index < path.length; index += 1) {
    const key = path[index];

    if (index === path.length - 1) {
      cursor[key] = value;
      return;
    }

    const next = cursor[key];

    if (!isPlainObject(next)) {
      cursor[key] = {};
    }

    cursor = cursor[key] as AnyRecord;
  }
}

function mergePlainObjects(first: AnyRecord, second: AnyRecord): AnyRecord {
  const result = { ...first };

  for (const [key, value] of Object.entries(second)) {
    const previousValue = result[key];

    result[key] =
      isPlainObject(previousValue) && isPlainObject(value)
        ? mergePlainObjects(previousValue, value)
        : value;
  }

  return result;
}

function schemaIsPending(schema: AnyRecord): boolean {
  return Object.values(schema).some((fieldOrSchema) =>
    isFieldContract(fieldOrSchema)
      ? readStoreSnapshot(normalizeField(fieldOrSchema).isValidationPending)
      : schemaIsPending(fieldOrSchema),
  );
}

function attachSchemaChangeValidation(schema: AnyRecord, validate: () => Promise<void>): void {
  for (const fieldOrSchema of Object.values(schema)) {
    if (isFieldContract(fieldOrSchema)) {
      const field = normalizeField(fieldOrSchema);

      reaction({
        on: field.changed,
        run() {
          const currentScope = requireCurrentScope();

          void scoped(currentScope, () => validate());
        },
      });
    } else {
      attachSchemaChangeValidation(fieldOrSchema, validate);
    }
  }
}

function pickSchema(schema: AnyRecord, selection: AnyRecord): AnyRecord {
  const result: AnyRecord = {};

  for (const [key, value] of Object.entries(selection)) {
    if (!(key in schema)) {
      continue;
    }

    if (value === true || isFieldContract(schema[key])) {
      result[key] = schema[key];
    } else {
      result[key] = pickSchema(schema[key], value as AnyRecord);
    }
  }

  return result;
}

function readFieldChildren(field: FieldContract<any, any, any>): Readonly<Record<string, AnyField>> {
  if (field.readFields) {
    return field.readFields();
  }

  if (!field.fields) {
    return {};
  }

  if (isStoreUnit(field.fields)) {
    return readStoreSnapshot(field.fields as Store<Readonly<Record<string, AnyField>>>);
  }

  return field.fields;
}

function isFieldContract(value: unknown): value is AnyField {
  return Boolean(
    value &&
      typeof value === "object" &&
      "kind" in value &&
      "state" in value &&
      "fill" in value &&
      "reset" in value,
  );
}

function isStoreUnit(value: unknown): value is AnyStore {
  return Boolean(
    value &&
      typeof value === "object" &&
      "node" in value &&
      "subscribe" in value &&
      typeof (value as { subscribe?: unknown }).subscribe === "function",
  );
}

function isPlainObject(value: unknown): value is AnyRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayStoreSnapshot(unit: AnyStore, keys: readonly PropertyKey[]): boolean {
  return (
    keys.includes("length") &&
    keys.every((key) => key === "length" || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key))) &&
    typeof Reflect.get(unit as object, "length") === "number"
  );
}

function hasErrors(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(hasErrors);
  }

  if (typeof value === "object") {
    return Object.values(value).some(hasErrors);
  }

  return true;
}

function deepEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) {
    return true;
  }

  if (typeof first !== typeof second) {
    return false;
  }

  if (!first || !second || typeof first !== "object" || typeof second !== "object") {
    return false;
  }

  if (Array.isArray(first) || Array.isArray(second)) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
      return false;
    }

    return first.every((item, index) => deepEqual(item, second[index]));
  }

  const firstKeys = Object.keys(first as AnyRecord);
  const secondKeys = Object.keys(second as AnyRecord);

  if (firstKeys.length !== secondKeys.length) {
    return false;
  }

  return firstKeys.every((key) => deepEqual((first as AnyRecord)[key], (second as AnyRecord)[key]));
}

function cloneSnapshot<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneSnapshot(item)) as T;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneSnapshot(item)]),
    ) as T;
  }

  return value;
}

function toArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }

  return (Array.isArray(value) ? value : [value]) as readonly T[];
}

function emptyFields(): Readonly<Record<string, AnyField>> {
  return {};
}

function requireCurrentScope(): Scope {
  const scope = getCurrentScope();

  if (!scope) {
    throw new Error("Scope is required");
  }

  return scope;
}

function clampIndex(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasIndex(items: readonly unknown[], index: number): boolean {
  return index >= 0 && index < items.length;
}

function appendUnique<T>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values : [...values, value];
}
