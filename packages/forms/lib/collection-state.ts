import type { Effect } from "@virentia/core";
import type { FieldCell } from "./field-state";
import type { AnyField, FieldError } from "./types";

interface CollectionState {
  revision: FieldCell<number>;
  commit: Effect<void, void>;
}
export interface ArrayModelState extends CollectionState {
  items: FieldCell<readonly AnyField[]>;
  innerError: FieldCell<FieldError>;
  outerError: FieldCell<FieldError>;
  createItem(value: unknown, index: number): AnyField;
  initialItems(): Promise<readonly AnyField[]>;
}
export interface ShapeModelState extends CollectionState {
  fields: FieldCell<Record<string, AnyField>>;
  ownErrors: FieldCell<Record<string, unknown> | null>;
  createField(key: string, value: unknown): AnyField;
  initialFields(): Promise<Record<string, AnyField>>;
}
let array: ArrayModelState | undefined;
let shape: ShapeModelState | undefined;
export const arrayModelState = () => array;
export const shapeModelState = () => shape;
export function withArrayModelState<T>(state: ArrayModelState, run: () => T): T {
  const previous = array; array = state;
  try { return run(); } finally { array = previous; }
}
export function withShapeModelState<T>(state: ShapeModelState, run: () => T): T {
  const previous = shape; shape = state;
  try { return run(); } finally { shape = previous; }
}
