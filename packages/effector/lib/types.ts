import type {
  Effect as EffectorEffect,
  Event as EffectorEvent,
  EventCallable as EffectorEventCallable,
  Store as EffectorStore,
} from "effector";
import type {
  Effect as VirentiaEffect,
  Event as VirentiaEvent,
  EventCallable as VirentiaEventCallable,
  Store as VirentiaStore,
  StoreWritable as VirentiaStoreWritable,
} from "@virentia/core";
import type {
  AnyField,
  AnyForm,
  ArrayField,
  Form,
  NormalizeSchema,
  SchemaErrors,
  SchemaValues,
  ShapeField,
} from "@virentia/forms";

/**
 * Any virentia unit that can appear on a field/form and therefore be projected
 * into the effector lens.
 */
export type AnyVirentiaUnit =
  | VirentiaStore<any>
  | VirentiaStoreWritable<any>
  | VirentiaEvent<any>
  | VirentiaEventCallable<any>
  | VirentiaEffect<any, any, any>;

type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] };

/** Marker set by `first()` / `last()` / `single()` (mirrors `@effector-kit/models`). */
export interface SingleResultLensMarker {
  readonly "~single": true;
}

/** Read-only unit projection: you may only watch it. */
export interface WatchableUnitActions<T> {
  clock(): EffectorEvent<T>;
}

/** Writable unit projection: watch it and dispatch into it. */
export interface TargetableUnitActions<T, Props = never>
  extends WatchableUnitActions<T> {
  target(
    map?: (props: Props) => T,
  ): EffectorEventCallable<[Props] extends [never] ? T : Props>;
}

/**
 * Actions available for a single virentia unit, chosen by the unit's kind.
 * EventCallable / StoreWritable / Effect are targetable; read-only Store / Event
 * are watch-only. Order matters: the writable/callable variants extend the
 * read-only ones, so they must be tested first.
 */
export type UnitActions<U, Props = never> =
  U extends VirentiaEventCallable<infer T>
    ? TargetableUnitActions<T, Props>
    : U extends VirentiaEffect<infer P, any, any>
      ? TargetableUnitActions<P, Props>
      : U extends VirentiaStoreWritable<infer T>
        ? TargetableUnitActions<T, Props>
        : U extends VirentiaStore<infer T>
          ? WatchableUnitActions<T>
          : U extends VirentiaEvent<infer T>
            ? WatchableUnitActions<T>
            : never;

/**
 * Lens API for a single (non-collection) field: the field's own units, each
 * mapped to its watch/target actions. Non-unit members (methods, `kind`) drop
 * out via `OmitNever`. Recursive by design — a nested plain group stays a plain
 * object of the same shape (see `SchemaLens`).
 */
export type FieldLensApi<F, Props = never> = OmitNever<{
  [K in keyof F]: UnitActions<F[K], Props>;
}>;

/**
 * Selection operators shared by every collection lens (array field, shape
 * field). Mirrors `@effector-kit/models`' `LensApi`, keyed by a stable id.
 */
export interface CollectionLensOps<
  ItemApi,
  Props = never,
  Single extends boolean = false,
> {
  /** Current matched instances keyed by their stable id. */
  getSource(): Record<string, unknown>;
  /** Narrow to explicit stable ids. */
  ids(...ids: string[]): CollectionLens<ItemApi, Props, Single>;
  /** Narrow by a predicate over each instance's data (plus its `id`). */
  where(
    predicate: [Props] extends [never]
      ? (data: Record<string, unknown> & { id: string }) => boolean
      : (data: Record<string, unknown> & { id: string }, props: Props) => boolean,
  ): CollectionLens<ItemApi, Props, Single>;
  first(): CollectionLens<ItemApi, Props, true>;
  last(): CollectionLens<ItemApi, Props, true>;
  single(): CollectionLens<ItemApi, Props, true>;
  /** Delete all currently matched instances. */
  delete(): EffectorEventCallable<void>;
  /** Bind external props threaded into `where`/`target` map callbacks. */
  props<T>(): CollectionLens<ItemApi, T, Single>;
}

/**
 * A lens over a keyed collection of instances (array-field items keyed by a
 * stable id, or shape-field children keyed by their key). Exposes the item's
 * own lens api aggregated across matched instances, plus selection operators.
 */
export type CollectionLens<
  ItemApi,
  Props = never,
  Single extends boolean = false,
> = ItemApi &
  CollectionLensOps<ItemApi, Props, Single> &
  (Single extends true ? SingleResultLensMarker : {});

/**
 * Projects a normalized schema node into its lens shape:
 * - array field  -> collection lens over the item field's lens api
 * - shape field  -> collection lens over a generic field lens api
 * - leaf field   -> the field's own unit actions
 * - plain group  -> recursion, one lens node per key
 *
 * Array/shape fields extend the normalized-field contract, so they must be
 * matched before the generic `AnyField` branch.
 */
export type SchemaLens<Node> =
  Node extends ArrayField<any, infer Item>
    ? CollectionLens<SchemaLens<Item>>
    : Node extends ShapeField<any>
      ? CollectionLens<FieldLensApi<AnyField>>
      : Node extends AnyField
        ? FieldLensApi<Node>
        : Node extends Record<string, any>
          ? { [K in keyof Node]: SchemaLens<Node[K]> }
          : never;

/**
 * The effector-facing projection of a virentia form. Top-level state is exposed
 * as `$`-prefixed effector stores; lifecycle events as effector events; every
 * mutating method as an effector effect that runs the virentia method inside the
 * associated virentia scope. Nested units live under `fields` as a lens tree
 * shaped like `@effector-kit/models`.
 */
export interface EffectorForm<
  Schema extends Record<string, any>,
  Values = SchemaValues<Schema>,
  Errors = SchemaErrors<Schema>,
> {
  readonly $values: EffectorStore<Values>;
  readonly $value: EffectorStore<Values>;
  readonly $errors: EffectorStore<Errors>;
  readonly $innerErrors: EffectorStore<Errors>;
  readonly $outerErrors: EffectorStore<Errors>;
  readonly $snapshot: EffectorStore<Values>;
  readonly $isChanged: EffectorStore<boolean>;
  readonly $isValid: EffectorStore<boolean>;
  readonly $isValidationPending: EffectorStore<boolean>;

  readonly filled: EffectorEvent<Values>;
  readonly changed: EffectorEvent<Values>;
  readonly errorsChanged: EffectorEvent<Errors>;
  readonly validated: EffectorEvent<Values>;
  readonly validationFailed: EffectorEvent<Values>;
  readonly submitted: EffectorEvent<Values>;
  readonly validatedAndSubmitted: EffectorEvent<Values>;

  readonly submit: EffectorEffect<void, void>;
  readonly validate: EffectorEffect<void, void>;
  readonly fill: EffectorEffect<
    { values?: Partial<Values>; errors?: Partial<Errors> },
    void
  >;
  readonly reset: EffectorEffect<void, void>;
  readonly clearOuterErrors: EffectorEffect<void, void>;
  readonly clearInnerErrors: EffectorEffect<void, void>;
  readonly forceUpdateSnapshot: EffectorEffect<void, void>;

  readonly fields: SchemaLens<NormalizeSchema<Schema>>;
}

export type { AnyForm, Form };
