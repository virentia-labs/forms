import type { AnyModel, InstanceApi } from "@virentia/core/models";
import type { AnyField } from "./types";

export interface FieldModelSpec {
  input(value: unknown): Record<string, unknown>;
}
export interface FieldModelInstance extends InstanceApi { readonly field: AnyField }
export interface FieldModelSource {
  readonly definition: AnyModel;
  readonly instance: FieldModelInstance;
}
const definitions = new WeakMap<object, FieldModelSpec>();
const fields = new WeakMap<object, FieldModelSource>();
export const fieldModelSpec = (definition: object) => definitions.get(definition);
export const fieldModelSource = (field: object) => fields.get(field);
export function registerFieldModel(definition: AnyModel, spec: FieldModelSpec): void {
  definitions.set(definition, spec);
}
export function registerModelField(definition: AnyModel, instance: FieldModelInstance): void {
  fields.set(instance.field, { definition, instance });
}
