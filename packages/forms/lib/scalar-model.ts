// Optional entity-model entry: main Forms imports remain independent of the
// schema backend. One fieldModel declaration supplies every child instance.
import { f, staticModel, trait } from "@virentia/core/models";
import type { Field as DataField } from "@virentia/core/models";
import { modelInstanceBindingOf } from "@virentia/core/internal";
import { createField } from "./field";
import { fieldRevision, withFieldState } from "./field-state";
import { cloneSnapshot, modelFieldValue, registerNormalizedField } from "./shared";
import { registerFieldModel, registerModelField } from "./model-field-binding";
import type { CreateFieldOptions, Field, FieldError, ValidationFunction, ValidationEffect } from "./types";

type IdentityOptions = { name?: string; sid?: string };
const factoryDefaults = Symbol("forms.field.factoryDefaults");
interface FactoryDefaults { value: unknown; meta: object; error: FieldError }
type Options<Value, Meta extends object> = CreateFieldOptions<Value, Meta> & IdentityOptions;
type FunctionOptions<Value, Meta extends object> = Omit<Options<Value, Meta>, "validate"> & {
  validate?: ValidationFunction<Value, FieldError> | readonly ValidationFunction<Value, FieldError>[];
};
type EffectOptions<Value, Meta extends object> = Omit<Options<Value, Meta>, "validate"> & {
  validate?: ValidationEffect<Value, FieldError> | readonly ValidationEffect<Value, FieldError>[];
};

export function fieldModel<Value, Meta extends object = Record<string, never>, Custom extends Field<Value, Meta> = Field<Value, Meta>>(
  initial: Value,
  options: FunctionOptions<Value, Meta> & { create(initial: Value, options: CreateFieldOptions<Value, Meta>): Custom },
): ReturnType<typeof declareFieldModel<Value, Meta, Custom>>;
export function fieldModel<Value, Meta extends object = Record<string, never>, Custom extends Field<Value, Meta> = Field<Value, Meta>>(
  initial: Value,
  options: EffectOptions<Value, Meta> & { create(initial: Value, options: CreateFieldOptions<Value, Meta>): Custom },
): ReturnType<typeof declareFieldModel<Value, Meta, Custom>>;
export function fieldModel<Value, Meta extends object = Record<string, never>, Custom extends Field<Value, Meta> = Field<Value, Meta>>(
  initial: Value,
  options: Options<Value, Meta> & { create(initial: Value, options: CreateFieldOptions<Value, Meta>): Custom },
): ReturnType<typeof declareFieldModel<Value, Meta, Custom>>;

export function fieldModel<Value, Meta extends object = Record<string, never>>(
  initial: Value,
  options?: FunctionOptions<Value, Meta>,
): ReturnType<typeof declareFieldModel<Value, Meta>>;
export function fieldModel<Value, Meta extends object = Record<string, never>>(
  initial: Value,
  options?: EffectOptions<Value, Meta>,
): ReturnType<typeof declareFieldModel<Value, Meta>>;
export function fieldModel<Value, Meta extends object = Record<string, never>>(
  initial: Value,
  options?: Options<Value, Meta>,
): ReturnType<typeof declareFieldModel<Value, Meta>>;
export function fieldModel<Value, Meta extends object = Record<string, never>>(
  initial: Value,
  options: Options<Value, Meta> & { create?(initial: Value, options: CreateFieldOptions<Value, Meta>): Field<Value, Meta> } = {},
) { return declareFieldModel(initial, options); }

function declareFieldModel<Value, Meta extends object, Custom extends Field<Value, Meta> = Field<Value, Meta>>(
  initial: Value,
  options: Options<Value, Meta> & { create?(initial: Value, options: CreateFieldOptions<Value, Meta>): Custom },
) {
  const meta = (options.meta ?? {}) as Meta;
  const error = options.error ?? null;
  const ValueState = trait({
    data: {
      value: f.any(initial) as DataField<Value, null, true>, metaValue: (f.any(meta) as DataField<Meta, null, true>).local(), focused: f.boolean(false).local(),
      initialValue: (f.any(initial) as DataField<Value, null, true>).local(), initialMeta: (f.any(meta) as DataField<Meta, null, true>).local(),
      initialized: f.boolean(false).local(),
      revision: f.number(0).local(),
    },
  });
  const ValidationState = trait({
    data: {
      innerErrorValue: f.union([f.string(), f.null()], null).local(),
      outerErrorValue: f.union([f.string(), f.null()], error).local(),
      initialOuterError: f.union([f.string(), f.null()], error).local(),
    },
  });
  const Model = staticModel({
    name: options.name, sid: options.sid,
    with: [ValueState, ValidationState],
    setup(self) {
      let defaults: FactoryDefaults | undefined;
      const source = withFieldState({
        value: self.value, meta: self.metaValue, focused: self.focused,
        innerError: self.innerErrorValue, outerError: self.outerErrorValue,
        initialValue: self.initialValue, initialMeta: self.initialMeta,
        initialOuterError: self.initialOuterError,
        revision: self.revision,
        captureDefaults: options.create ? (value, meta, error) => { defaults = { value, meta, error }; } : undefined,
      }, () => options.create ? options.create(initial, options) : createField(initial, options));
      // Each .static() call declares another graph; retain the defaults on its
      // own field API rather than sharing the last factory result across graphs.
      if (defaults) Object.defineProperty(source, factoryDefaults, { value: defaults });
      if (!(fieldRevision in source)) Object.defineProperty(source, fieldRevision, { value: self.revision });
      const field = modelFieldValue(registerNormalizedField(source));
      return { field: field as Custom };
    },
    onCreate(self) {
      if (!self.initialized.value) {
        const defaults = (self.field as unknown as { [factoryDefaults]?: FactoryDefaults })[factoryDefaults];
        if (defaults) {
          const props = modelInstanceBindingOf(self)!.props;
          if (!("value" in props) && !Object.is(defaults.value, initial)) self.value.value = cloneSnapshot(defaults.value) as typeof self.value.value;
          if (defaults.meta !== meta) self.metaValue.value = cloneSnapshot(defaults.meta) as Meta;
          if (defaults.error !== error) self.outerErrorValue.value = defaults.error;
        }
        self.initialValue.value = self.value.value;
        self.initialMeta.value = self.metaValue.value;
        self.initialOuterError.value = self.outerErrorValue.value;
        self.initialized.value = true;
      }
      registerModelField(Model, self);
    },
  });
  registerFieldModel(Model, { input: value => ({ value }) });
  return Model;
}
