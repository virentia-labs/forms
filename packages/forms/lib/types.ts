import type { Event, EventCallable, Effect, Store, StoreWritable } from "@virentia/core";

export type MaybePromise<T> = T | Promise<T>;
export type FieldError = string | null;
export type ValidationStrategy = "change" | "blur" | "focus" | "submit" | "manual";
export type PartialRecursive<T> = T extends readonly (infer Item)[]
  ? readonly PartialRecursive<Item>[]
  : T extends object
    ? { [Key in keyof T]?: PartialRecursive<T[Key]> }
    : T;

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

export type WizardFormStepSelection = {
  readonly [Key: string]: true | WizardFormStepSelection;
};

export type WizardFormStepConfig<
  Id extends string = string,
  FormInput = true | WizardFormStepSelection,
> = {
  readonly id: Id;
  readonly title?: string;
  readonly when?: (ctx: WizardWhenContext) => boolean;
} & (
  | {
      readonly form: FormInput;
      readonly pick?: never;
    }
  | {
      readonly form?: never;
      readonly pick: Exclude<FormInput, true>;
    }
);

export type WizardFormStepInput<Schema extends AnyRecord = AnyRecord> =
  | WizardStep<string, AnyForm>
  | WizardFormStepConfig<string, true | SelectionShape<NormalizeSchema<Schema>>>;

export type ResolveWizardFormStep<
  Schema extends AnyRecord,
  StepInput,
> = StepInput extends WizardStep<infer Id, infer StepForm>
  ? WizardStep<Id, StepForm>
  : StepInput extends {
        readonly id: infer Id extends string;
        readonly pick: infer Selection extends SelectionShape<NormalizeSchema<Schema>>;
      }
    ? WizardStep<Id, FormProjection<PickSchema<NormalizeSchema<Schema>, Selection>>>
    : StepInput extends {
          readonly id: infer Id extends string;
          readonly form: true;
        }
      ? WizardStep<Id, Form<Schema>>
      : StepInput extends {
            readonly id: infer Id extends string;
            readonly form: infer Selection extends SelectionShape<NormalizeSchema<Schema>>;
          }
        ? WizardStep<Id, FormProjection<PickSchema<NormalizeSchema<Schema>, Selection>>>
        : never;

export type ResolveWizardFormSteps<
  Schema extends AnyRecord,
  StepsInput extends readonly WizardFormStepInput<Schema>[],
> = {
  readonly [Index in keyof StepsInput]: ResolveWizardFormStep<Schema, StepsInput[Index]>;
};

export type CreateWizardFormConfig<
  Schema extends AnyRecord,
  StepsInput extends readonly WizardFormStepInput<Schema>[],
> = CreateFormConfig<Schema> & {
  steps: StepsInput | ((form: Form<Schema>) => StepsInput);
};

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
