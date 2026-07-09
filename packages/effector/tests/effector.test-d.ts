/**
 * Type-level tests for @virentia/forms-effector's projection types
 * (packages/effector/lib/types.ts).
 *
 * These are verified ONLY by `pnpm typecheck` (tsc --noEmit) — vitest never runs
 * `*.test-d.ts`. Every assertion is a compile-time fact:
 *   - positive facts as `type _x = Expect<Equal<Actual, Expected>>`
 *   - negative facts as a `// @ts-expect-error` immediately above a line that MUST
 *     be a real type error (an unused @ts-expect-error is itself a tsc error).
 *
 * Requirements extracted branch-by-branch from lib/types.ts:
 *   - AnyVirentiaUnit covers the 5 virentia unit kinds.
 *   - UnitActions discrimination: EventCallable / Effect / StoreWritable -> Targetable
 *     (HAS `target`); read-only Store / Event -> Watchable (clock only, NO target);
 *     everything else -> never. Order matters (writable/callable extend read-only).
 *   - FieldLensApi: field units -> their actions; non-unit members drop via OmitNever.
 *   - CollectionLensOps surface + selection-operator return kinds + Single marker.
 *   - CollectionLens = ItemApi & Ops (& marker when Single).
 *   - SchemaLens projection: ArrayField -> collection over item lens; ShapeField ->
 *     collection over the generic AnyField lens; leaf AnyField -> FieldLensApi; plain
 *     group -> recursion; anything else -> never.
 *   - EffectorForm member kinds ($ -> Store, lifecycle -> Event, methods -> Effect),
 *     and `fill`'s `{ values?: Partial<Values>; errors?: Partial<Errors> }` payload.
 *   - formToEffector(form) -> EffectorForm<Schema>.
 */

import { formToEffector } from "../lib";
import type {
  AnyVirentiaUnit,
  CollectionLens,
  CollectionLensOps,
  EffectorForm,
  FieldLensApi,
  SchemaLens,
  SingleResultLensMarker,
  TargetableUnitActions,
  UnitActions,
  WatchableUnitActions,
} from "../lib/types";
// The lib module also re-exports the two virentia form types by name.
import type { Form as FormFromLib, AnyForm as AnyFormFromLib } from "../lib/types";
import type {
  Store as EStore,
  Event as EEvent,
  EventCallable as EEventCallable,
  Effect as EEffect,
} from "effector";
import type {
  Store as VStore,
  StoreWritable as VStoreWritable,
  Event as VEvent,
  EventCallable as VEventCallable,
  Effect as VEffect,
} from "@virentia/core";
import type {
  AnyField,
  ArrayField,
  Field,
  FieldError,
  Form,
  AnyForm,
  NormalizeSchema,
  SchemaErrors,
  SchemaValues,
  ShapeField,
} from "@virentia/forms";

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;
type Assignable<A, B> = A extends B ? true : false;
type KeyPresent<T, K extends PropertyKey> = K extends keyof T ? true : false;

/* ================================================================== *
 * 1. AnyVirentiaUnit — every projectable virentia unit is a member
 * ================================================================== */

type _anyUnit_store = Expect<Assignable<VStore<number>, AnyVirentiaUnit>>;
type _anyUnit_writable = Expect<Assignable<VStoreWritable<number>, AnyVirentiaUnit>>;
type _anyUnit_event = Expect<Assignable<VEvent<number>, AnyVirentiaUnit>>;
type _anyUnit_callable = Expect<Assignable<VEventCallable<number>, AnyVirentiaUnit>>;
type _anyUnit_effect = Expect<Assignable<VEffect<number, void>, AnyVirentiaUnit>>;

/* ================================================================== *
 * 2. UnitActions — kind discrimination
 * ================================================================== */

// Read-only Store / Event -> WatchableUnitActions (clock only).
type _ua_store = Expect<Equal<UnitActions<VStore<number>>, WatchableUnitActions<number>>>;
type _ua_event = Expect<Equal<UnitActions<VEvent<number>>, WatchableUnitActions<number>>>;

// EventCallable / Effect / StoreWritable -> TargetableUnitActions (clock + target).
type _ua_callable = Expect<
  Equal<UnitActions<VEventCallable<number>>, TargetableUnitActions<number>>
>;
type _ua_writable = Expect<
  Equal<UnitActions<VStoreWritable<number>>, TargetableUnitActions<number>>
>;
type _ua_effect = Expect<
  Equal<UnitActions<VEffect<number, void>>, TargetableUnitActions<number>>
>;

// Ordering: a StoreWritable is structurally assignable to a read-only Store, yet the
// writable branch is tested FIRST, so it must project to Targetable, not Watchable.
type _ua_writable_not_watchable = Expect<
  Equal<Equal<UnitActions<VStoreWritable<number>>, WatchableUnitActions<number>>, false>
>;
// Same for EventCallable vs the read-only Event branch.
type _ua_callable_not_watchable = Expect<
  Equal<Equal<UnitActions<VEventCallable<number>>, WatchableUnitActions<number>>, false>
>;

// The Effect's PARAMS type (not Done) is what drives the target payload.
type _ua_effect_params = Expect<
  Equal<UnitActions<VEffect<{ id: string }, boolean>>, TargetableUnitActions<{ id: string }>>
>;

// void payloads stay void.
type _ua_voidCallable = Expect<
  Equal<UnitActions<VEventCallable<void>>, TargetableUnitActions<void>>
>;
type _ua_voidEvent = Expect<Equal<UnitActions<VEvent<void>>, WatchableUnitActions<void>>>;

// Non-units fall through to `never` (the terminal branch).
type _ua_fn = Expect<Equal<UnitActions<() => void>, never>>;
type _ua_string = Expect<Equal<UnitActions<string>, never>>;
type _ua_object = Expect<Equal<UnitActions<{ a: number }>, never>>;
type _ua_number = Expect<Equal<UnitActions<number>, never>>;

/* ================================================================== *
 * 3. Watchable / Targetable action shapes (effector-facing)
 * ================================================================== */

// clock() yields a read-only effector Event; target() yields an EventCallable.
type _clockReturns = Expect<
  Equal<ReturnType<WatchableUnitActions<number>["clock"]>, EEvent<number>>
>;
type _targetReturns = Expect<
  Equal<ReturnType<TargetableUnitActions<number>["target"]>, EEventCallable<number>>
>;
// Targetable inherits clock() from Watchable.
type _targetInheritsClock = Expect<
  Equal<ReturnType<TargetableUnitActions<number>["clock"]>, EEvent<number>>
>;

// Props defaulting to never -> the target payload is T and the map arg is `never`.
declare const targetNoProps: TargetableUnitActions<string>;
const _targetPlain = targetNoProps.target();
type _targetPlainType = Expect<Equal<typeof _targetPlain, EEventCallable<string>>>;

// Bound props -> target payload becomes Props and the map callback receives Props.
declare const targetWithProps: TargetableUnitActions<string, { id: number }>;
const _targetMapped = targetWithProps.target((props) => {
  const _p: { id: number } = props; // props is threaded as { id: number }
  return String(_p.id);
});
type _targetMappedType = Expect<Equal<typeof _targetMapped, EEventCallable<{ id: number }>>>;
type _targetPropsReturn = Expect<
  Equal<ReturnType<TargetableUnitActions<string, { id: number }>["target"]>, EEventCallable<{ id: number }>>
>;

// A watch-only projection exposes `clock` but never `target`.
declare const readOnlyActions: UnitActions<VStore<number>>;
const _watchClock = readOnlyActions.clock; // exists
// @ts-expect-error — a read-only store projects to watch-only actions: no `target`.
readOnlyActions.target;

declare const eventActions: UnitActions<VEvent<number>>;
// @ts-expect-error — a read-only event projects to watch-only actions: no `target`.
eventActions.target;

// Targetable projections DO expose target (these must NOT error).
declare const writableActions: UnitActions<VStoreWritable<number>>;
const _writableTarget = writableActions.target;
declare const callableActions: UnitActions<VEventCallable<number>>;
const _callableTarget = callableActions.target;
declare const effectActions: UnitActions<VEffect<number, void>>;
const _effectTarget = effectActions.target;

/* ================================================================== *
 * 4. FieldLensApi — unit members map to actions, non-units drop out
 * ================================================================== */

// A fully-controlled synthetic field pins the exact projected shape.
interface SyntheticField {
  kind: "field"; // -> never (dropped)
  state: VStore<number>; // -> Watchable
  meta: VStore<{ touched: boolean }>; // -> Watchable
  change: VEventCallable<number>; // -> Targetable
  changed: VEvent<number>; // -> Watchable
  validate: VEventCallable<void>; // -> Targetable
  fill(payload: number): Promise<void>; // -> never (dropped)
  reset(): Promise<void>; // -> never (dropped)
  read(): number; // -> never (dropped)
}

type _syntheticLens = Expect<
  Equal<
    FieldLensApi<SyntheticField>,
    {
      state: WatchableUnitActions<number>;
      meta: WatchableUnitActions<{ touched: boolean }>;
      change: TargetableUnitActions<number>;
      changed: WatchableUnitActions<number>;
      validate: TargetableUnitActions<void>;
    }
  >
>;

// Now the real Field<Value, Meta> — assert the discriminated members individually.
type F1 = Field<string, { touched: boolean }>;
type F1Lens = FieldLensApi<F1>;

type _f1_state = Expect<Equal<F1Lens["state"], WatchableUnitActions<string>>>;
type _f1_changed = Expect<Equal<F1Lens["changed"], WatchableUnitActions<string>>>;
type _f1_error = Expect<Equal<F1Lens["error"], WatchableUnitActions<FieldError>>>;
type _f1_errors = Expect<Equal<F1Lens["errors"], WatchableUnitActions<FieldError>>>;
type _f1_isValid = Expect<Equal<F1Lens["isValid"], WatchableUnitActions<boolean>>>;
type _f1_isPending = Expect<Equal<F1Lens["isValidationPending"], WatchableUnitActions<boolean>>>;
type _f1_meta = Expect<Equal<F1Lens["meta"], WatchableUnitActions<{ touched: boolean }>>>;
type _f1_isFocused = Expect<Equal<F1Lens["isFocused"], WatchableUnitActions<boolean>>>;
type _f1_validated = Expect<Equal<F1Lens["validated"], WatchableUnitActions<string>>>;
type _f1_focused = Expect<Equal<F1Lens["focused"], WatchableUnitActions<void>>>;
type _f1_blurred = Expect<Equal<F1Lens["blurred"], WatchableUnitActions<void>>>;

type _f1_change = Expect<Equal<F1Lens["change"], TargetableUnitActions<string>>>;
type _f1_validate = Expect<Equal<F1Lens["validate"], TargetableUnitActions<void>>>;
type _f1_focus = Expect<Equal<F1Lens["focus"], TargetableUnitActions<void>>>;
type _f1_blur = Expect<Equal<F1Lens["blur"], TargetableUnitActions<void>>>;
type _f1_changeError = Expect<Equal<F1Lens["changeError"], TargetableUnitActions<FieldError>>>;
type _f1_changeMeta = Expect<Equal<F1Lens["changeMeta"], TargetableUnitActions<{ touched: boolean }>>>;

// EventCallable (singular `setInnerError`) survives; the async method
// (plural `setInnerErrors`) drops out — a precise unit-vs-method discrimination.
type _f1_setInnerError = Expect<Equal<F1Lens["setInnerError"], TargetableUnitActions<FieldError>>>;
type _f1_setOuterError = Expect<Equal<F1Lens["setOuterError"], TargetableUnitActions<FieldError>>>;

// REQUIRED non-unit members are omitted entirely (T[K] is exactly `never`, so
// OmitNever's `T[K] extends never ? never : K` remaps the key away).
type _f1_no_kind = Expect<Equal<KeyPresent<F1Lens, "kind">, false>>;
type _f1_no_fill = Expect<Equal<KeyPresent<F1Lens, "fill">, false>>;
type _f1_no_reset = Expect<Equal<KeyPresent<F1Lens, "reset">, false>>;
type _f1_no_read = Expect<Equal<KeyPresent<F1Lens, "read">, false>>;
type _f1_no_readFields = Expect<Equal<KeyPresent<F1Lens, "readFields">, false>>;
type _f1_no_setInnerErrors = Expect<Equal<KeyPresent<F1Lens, "setInnerErrors">, false>>;
type _f1_no_setOuterErrors = Expect<Equal<KeyPresent<F1Lens, "setOuterErrors">, false>>;
type _f1_no_clearInnerErrors = Expect<Equal<KeyPresent<F1Lens, "clearInnerErrors">, false>>;
type _f1_no_clearOuterErrors = Expect<Equal<KeyPresent<F1Lens, "clearOuterErrors">, false>>;

// BUG PIN (see bugsSuspected: omit-never-optional-leak). The doc comment claims
// "Non-unit members (methods, `kind`) drop out via `OmitNever`", but OmitNever only
// drops REQUIRED never members. `serialize?` / `view?` are declared OPTIONAL on
// FieldContract and never redeclared as required, so for an optional key K,
// `F1Lens[K]` widens to `undefined` (NOT `never`), and `undefined extends never` is
// false — the key leaks through instead of being omitted. Pin current behavior:
type _f1_leak_serialize = Expect<Equal<KeyPresent<F1Lens, "serialize">, true>>;
type _f1_leak_view = Expect<Equal<KeyPresent<F1Lens, "view">, true>>;
// `fields?` is optional too; its `Store<any>` union arm survives distribution, so it
// leaks as a spurious watch action rather than the recursion it looks like.
type _f1_leak_fields = Expect<Equal<KeyPresent<F1Lens, "fields">, true>>;

// Props threading flows into every action produced by FieldLensApi.
type F1LensP = FieldLensApi<F1, { ctx: number }>;
type _f1p_change = Expect<Equal<F1LensP["change"], TargetableUnitActions<string, { ctx: number }>>>;

/* ================================================================== *
 * 5. CollectionLensOps — surface, selection ops, Props conditionals
 * ================================================================== */

type ItemApi = FieldLensApi<Field<string>>;
type Col = CollectionLens<ItemApi>; // Props = never, Single = false
type Ops = CollectionLensOps<ItemApi>;

// The exact operator surface.
type _opsKeys = Expect<
  Equal<
    keyof Ops,
    "getSource" | "ids" | "where" | "first" | "last" | "single" | "delete" | "props"
  >
>;

// getSource() reads a keyed record; delete() dispatches an EventCallable<void>.
type _getSource = Expect<Equal<ReturnType<Col["getSource"]>, Record<string, unknown>>>;
type _delete = Expect<Equal<ReturnType<Col["delete"]>, EEventCallable<void>>>;

// ids()/where() preserve Props + Single; first()/last()/single() flip Single -> true.
type _ids = Expect<Equal<ReturnType<Col["ids"]>, CollectionLens<ItemApi, never, false>>>;
type _where = Expect<Equal<ReturnType<Col["where"]>, CollectionLens<ItemApi, never, false>>>;
type _first = Expect<Equal<ReturnType<Col["first"]>, CollectionLens<ItemApi, never, true>>>;
type _last = Expect<Equal<ReturnType<Col["last"]>, CollectionLens<ItemApi, never, true>>>;
type _single = Expect<Equal<ReturnType<Col["single"]>, CollectionLens<ItemApi, never, true>>>;

// where() predicate arity depends on Props: never -> data only; set -> data + props.
type _whereNoProps = Expect<
  Equal<Parameters<Col["where"]>[0], (data: Record<string, unknown> & { id: string }) => boolean>
>;
type ColP = CollectionLens<ItemApi, { p: number }>;
type _wherePropsArg = Expect<
  Equal<
    Parameters<ColP["where"]>[0],
    (data: Record<string, unknown> & { id: string }, props: { p: number }) => boolean
  >
>;

// props<T>() rebinds the Props channel.
declare const col: Col;
const _rebound = col.props<{ q: number }>();
type _reboundType = Expect<Equal<typeof _rebound, CollectionLens<ItemApi, { q: number }, false>>>;

/* ================================================================== *
 * 6. CollectionLens = ItemApi & Ops (& SingleResultLensMarker when Single)
 * ================================================================== */

// Item-api members are reachable directly on the collection lens...
type _col_hasItemState = Expect<Equal<Col["state"], WatchableUnitActions<string>>>;
type _col_hasItemChange = Expect<Equal<Col["change"], TargetableUnitActions<string>>>;
// ...alongside the operator surface.
type _col_hasGetSource = Expect<Equal<KeyPresent<Col, "getSource">, true>>;

// The single marker is present only on Single = true lenses.
type _marker_shape = Expect<Equal<SingleResultLensMarker, { readonly "~single": true }>>;
type _single_hasMarker = Expect<
  Equal<KeyPresent<CollectionLens<ItemApi, never, true>, "~single">, true>
>;
type _nonsingle_noMarker = Expect<
  Equal<KeyPresent<CollectionLens<ItemApi, never, false>, "~single">, false>
>;
type _single_markerValue = Expect<
  Equal<CollectionLens<ItemApi, never, true>["~single"], true>
>;

/* ================================================================== *
 * 7. SchemaLens — node-kind projection (branch by branch)
 * ================================================================== */

// leaf AnyField -> FieldLensApi<Node>
type _sl_leaf = Expect<Equal<SchemaLens<Field<string>>, FieldLensApi<Field<string>>>>;
type _sl_leafNumber = Expect<Equal<SchemaLens<Field<number>>, FieldLensApi<Field<number>>>>;

// array field -> collection lens over the ITEM's lens api
type _sl_array = Expect<
  Equal<SchemaLens<ArrayField<string>>, CollectionLens<SchemaLens<Field<string>>>>
>;
type _sl_array_itemExpanded = Expect<
  Equal<SchemaLens<ArrayField<string>>, CollectionLens<FieldLensApi<Field<string>>>>
>;

// shape field -> collection lens over the GENERIC AnyField lens (no per-key recursion)
type _sl_shape = Expect<
  Equal<SchemaLens<ShapeField>, CollectionLens<FieldLensApi<AnyField>>>
>;
type _sl_shape_ignoresShapeParam = Expect<
  Equal<
    SchemaLens<ShapeField<{ name: Field<string>; age: Field<number> }>>,
    CollectionLens<FieldLensApi<AnyField>>
  >
>;

// plain nested group -> recursion, one lens node per key
type _sl_group = Expect<
  Equal<
    SchemaLens<{ user: { name: Field<string> }; tags: ArrayField<string> }>,
    {
      user: { name: FieldLensApi<Field<string>> };
      tags: CollectionLens<FieldLensApi<Field<string>>>;
    }
  >
>;

// recursion THROUGH a collection: array-of-shape and array-of-array
type _sl_arrayOfShape = Expect<
  Equal<
    SchemaLens<ArrayField<{ name: string }, ShapeField<{ name: Field<string> }>>>,
    CollectionLens<CollectionLens<FieldLensApi<AnyField>>>
  >
>;
type _sl_arrayOfArray = Expect<
  Equal<
    SchemaLens<ArrayField<readonly string[], ArrayField<string>>>,
    CollectionLens<CollectionLens<FieldLensApi<Field<string>>>>
  >
>;

// ArrayField and ShapeField extend the field contract, but are matched BEFORE the
// generic AnyField branch — so they never collapse to a leaf FieldLensApi.
type _sl_array_notLeaf = Expect<
  Equal<Equal<SchemaLens<ArrayField<string>>, FieldLensApi<ArrayField<string>>>, false>
>;
type _sl_shape_notLeaf = Expect<
  Equal<Equal<SchemaLens<ShapeField>, FieldLensApi<ShapeField>>, false>
>;

// anything that is neither a field nor a record -> never (terminal branch)
type _sl_string = Expect<Equal<SchemaLens<string>, never>>;
type _sl_number = Expect<Equal<SchemaLens<number>, never>>;
type _sl_boolean = Expect<Equal<SchemaLens<boolean>, never>>;

/* ================================================================== *
 * 8. EffectorForm — member kinds & fill payload
 * ================================================================== */

type S = { email: Field<string>; age: Field<number> };
type Values = SchemaValues<S>; // { email: string; age: number }
type Errors = SchemaErrors<S>; // { email: FieldError; age: FieldError }
type Model = EffectorForm<S>;

// $-members are effector stores (also proves SchemaValues/SchemaErrors resolution).
type _m_values = Expect<Equal<Model["$values"], EStore<{ email: string; age: number }>>>;
type _m_value = Expect<Equal<Model["$value"], EStore<Values>>>;
type _m_errors = Expect<Equal<Model["$errors"], EStore<{ email: FieldError; age: FieldError }>>>;
type _m_innerErrors = Expect<Equal<Model["$innerErrors"], EStore<Errors>>>;
type _m_outerErrors = Expect<Equal<Model["$outerErrors"], EStore<Errors>>>;
type _m_snapshot = Expect<Equal<Model["$snapshot"], EStore<Values>>>;
type _m_isChanged = Expect<Equal<Model["$isChanged"], EStore<boolean>>>;
type _m_isValid = Expect<Equal<Model["$isValid"], EStore<boolean>>>;
type _m_isPending = Expect<Equal<Model["$isValidationPending"], EStore<boolean>>>;

// lifecycle members are read-only effector events.
type _m_filled = Expect<Equal<Model["filled"], EEvent<Values>>>;
type _m_changed = Expect<Equal<Model["changed"], EEvent<Values>>>;
type _m_errorsChanged = Expect<Equal<Model["errorsChanged"], EEvent<Errors>>>;
type _m_validated = Expect<Equal<Model["validated"], EEvent<Values>>>;
type _m_validationFailed = Expect<Equal<Model["validationFailed"], EEvent<Values>>>;
type _m_submitted = Expect<Equal<Model["submitted"], EEvent<Values>>>;
type _m_validatedAndSubmitted = Expect<Equal<Model["validatedAndSubmitted"], EEvent<Values>>>;

// a lifecycle event is NOT a callable event (watch-only on the effector side too).
type _m_filled_notCallable = Expect<
  Equal<Equal<Model["filled"], EEventCallable<Values>>, false>
>;

// mutating methods are effector effects.
type _m_submit = Expect<Equal<Model["submit"], EEffect<void, void>>>;
type _m_validate = Expect<Equal<Model["validate"], EEffect<void, void>>>;
type _m_reset = Expect<Equal<Model["reset"], EEffect<void, void>>>;
type _m_clearOuter = Expect<Equal<Model["clearOuterErrors"], EEffect<void, void>>>;
type _m_clearInner = Expect<Equal<Model["clearInnerErrors"], EEffect<void, void>>>;
type _m_forceSnapshot = Expect<Equal<Model["forceUpdateSnapshot"], EEffect<void, void>>>;

// fill payload is exactly { values?: Partial<Values>; errors?: Partial<Errors> }.
type _m_fill = Expect<
  Equal<Model["fill"], EEffect<{ values?: Partial<Values>; errors?: Partial<Errors> }, void>>
>;
type _m_fill_params = Expect<
  Equal<
    Parameters<Model["fill"]>[0],
    { values?: Partial<{ email: string; age: number }>; errors?: Partial<{ email: FieldError; age: FieldError }> }
  >
>;

// fields is the SchemaLens of the normalized schema.
type _m_fields = Expect<Equal<Model["fields"], SchemaLens<NormalizeSchema<S>>>>;
type _m_fields_expanded = Expect<
  Equal<
    Model["fields"],
    { email: FieldLensApi<Field<string>>; age: FieldLensApi<Field<number>> }
  >
>;

// A richer schema: array field + nested group project as expected under `fields`.
type S2 = { tags: ArrayField<string>; address: { city: Field<string> } };
type _m2_fields = Expect<
  Equal<
    EffectorForm<S2>["fields"],
    {
      tags: CollectionLens<FieldLensApi<Field<string>>>;
      address: { city: FieldLensApi<Field<string>> };
    }
  >
>;

/* ================================================================== *
 * 9. formToEffector(form) -> EffectorForm<Schema>
 * ================================================================== */

declare const form: Form<S>;
const model = formToEffector(form);
type _return = Expect<Equal<typeof model, EffectorForm<S>>>;

declare const form2: Form<S2>;
const model2 = formToEffector(form2);
type _return2 = Expect<Equal<typeof model2, EffectorForm<S2>>>;

// The lib re-exports the two virentia form types.
type _reexport_form = Expect<Equal<FormFromLib<S>, Form<S>>>;
type _reexport_anyform = Expect<Equal<AnyFormFromLib, AnyForm>>;

/* ================================================================== *
 * 10. Negative surface — wrong usages must be type errors
 * ================================================================== */

declare const negModel: EffectorForm<{ email: Field<string> }>;

// Valid fill payloads (these must NOT error): both keys optional, FieldError allows null.
negModel.fill({});
negModel.fill({ values: { email: "ok" } });
negModel.fill({ values: { email: "ok" }, errors: { email: null } });
negModel.fill({ errors: { email: "boom" } });

// @ts-expect-error — `email` must be a string, not a number.
negModel.fill({ values: { email: 123 } });

// @ts-expect-error — `bogus` is not a valid fill payload key.
negModel.fill({ bogus: true });

// @ts-expect-error — `errors.email` must be `string | null`, not a boolean.
negModel.fill({ errors: { email: true } });

// A leaf field lens is NOT a collection lens: no getSource / ids / first / delete.
declare const leaf: FieldLensApi<Field<string>>;
// @ts-expect-error — leaf FieldLensApi has no collection `getSource`.
leaf.getSource();
// @ts-expect-error — leaf FieldLensApi has no collection `ids`.
leaf.ids("0");
// @ts-expect-error — leaf FieldLensApi has no collection `first`.
leaf.first();
// @ts-expect-error — leaf FieldLensApi has no collection `delete`.
leaf.delete();

// A collection lens is not a lifecycle event and vice versa.
declare const arrLens: SchemaLens<ArrayField<string>>;
const _arrGetSource = arrLens.getSource(); // ok — it IS a collection
// @ts-expect-error — a collection lens exposes no arbitrary `.notAnOp` operator shape as a value.
arrLens.notAnOp();
