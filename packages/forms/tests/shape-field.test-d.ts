import {
  createField,
  createShapeField,
  type AnyField,
  type Field,
  type FieldError,
  type ShapeField,
  type ShapeValues,
  type ShapeErrors,
} from "@virentia/forms";
import type { Event, EventCallable, Store } from "@virentia/core";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;
type StoreValue<S> = S extends Store<infer V> ? V : never;

// ---------------------------------------------------------------------------
// Factory return type + generic inference (field-contract shape / overload 1)
// ---------------------------------------------------------------------------
const shape = createShapeField({
  title: createField("Hello"),
  count: createField(0),
});

type Shape = { title: Field<string>; count: Field<number> };

// The factory returns a ShapeField specialised to the inferred shape.
const _return: ShapeField<Shape> = shape;
void _return;
// `kind` is typed as `string` on the FieldContract interface (not the literal).
type _kind = Expect<Equal<typeof shape.kind, string>>;

// state maps each child to its value.
type _state = Expect<
  Equal<StoreValue<typeof shape.state>, { title: string; count: number }>
>;
type _shapeValues = Expect<
  Equal<ShapeValues<Shape>, { title: string; count: number }>
>;

// errors maps each child to its error shape.
type _errors = Expect<
  Equal<StoreValue<typeof shape.errors>, { title: FieldError; count: FieldError }>
>;
type _innerErrors = Expect<
  Equal<
    StoreValue<typeof shape.innerErrors>,
    { title: FieldError; count: FieldError }
  >
>;
type _outerErrors = Expect<
  Equal<
    StoreValue<typeof shape.outerErrors>,
    { title: FieldError; count: FieldError }
  >
>;
type _shapeErrors = Expect<
  Equal<ShapeErrors<Shape>, { title: FieldError; count: FieldError }>
>;

// fields store.
type _fields = Expect<
  Equal<StoreValue<typeof shape.fields>, Readonly<Record<string, AnyField>>>
>;

// scalar stores.
type _isValid = Expect<Equal<typeof shape.isValid, Store<boolean>>>;
type _isPending = Expect<Equal<typeof shape.isValidationPending, Store<boolean>>>;

// events carry the value / error payloads.
type _changed = Expect<
  Equal<typeof shape.changed, Event<{ title: string; count: number }>>
>;
type _validated = Expect<
  Equal<typeof shape.validated, Event<{ title: string; count: number }>>
>;
type _validationFailed = Expect<
  Equal<typeof shape.validationFailed, Event<{ title: string; count: number }>>
>;
type _errorsChanged = Expect<
  Equal<
    typeof shape.errorsChanged,
    Event<{ title: FieldError; count: FieldError }>
  >
>;
type _validate = Expect<Equal<typeof shape.validate, EventCallable<void>>>;

// read / readFields / serialize return types.
type _read = Expect<
  Equal<ReturnType<typeof shape.read>, { title: string; count: number }>
>;
type _readFields = Expect<
  Equal<ReturnType<typeof shape.readFields>, Readonly<Record<string, AnyField>>>
>;
type _serialize = Expect<
  Equal<
    ReturnType<NonNullable<typeof shape.serialize>>,
    {
      value: { title: string; count: number };
      errors: { title: FieldError; count: FieldError };
    }
  >
>;

// ---------------------------------------------------------------------------
// Method parameter + return types (positive uses)
// ---------------------------------------------------------------------------
const okFill: Promise<void> = shape.fill({ title: "x" });
const okFillFull: Promise<void> = shape.fill({ title: "x", count: 2 });
const okAdd: Promise<void> = shape.add({ key: "extra", field: createField("v") });
const okReplace: Promise<void> = shape.replace({
  key: "title",
  field: createField("v"),
});
const okRemoveKnown: Promise<void> = shape.remove("title");
const okRemoveString: Promise<void> = shape.remove("dynamic-key");
const okReset: Promise<void> = shape.reset();
const okClear: Promise<void> = shape.clear();
const okValidate = shape.validate();
// setInnerErrors / setOuterErrors require the FULL ShapeErrors object.
const okSetInner: Promise<void> = shape.setInnerErrors({
  title: "bad",
  count: null,
});
const okSetOuter: Promise<void> = shape.setOuterErrors({
  title: null,
  count: "bad",
});
const okClearInner: Promise<void> = shape.clearInnerErrors();
const okClearOuter: Promise<void> = shape.clearOuterErrors();

void okFill;
void okFillFull;
void okAdd;
void okReplace;
void okRemoveKnown;
void okRemoveString;
void okReset;
void okClear;
void okValidate;
void okSetInner;
void okSetOuter;
void okClearInner;
void okClearOuter;

// ---------------------------------------------------------------------------
// Generic inference — raw values require options (overload 2)
// ---------------------------------------------------------------------------
const raw = createShapeField(
  { title: "hi", count: 0 },
  { createField: (_key, value) => createField(value) },
);
type _rawReturn = Expect<
  Equal<typeof raw, ShapeField<Record<"title" | "count", AnyField>>>
>;
type _rawState = Expect<
  Equal<StoreValue<typeof raw.state>, { title: any; count: any }>
>;

// ---------------------------------------------------------------------------
// Nested shape generic inference
// ---------------------------------------------------------------------------
const nested = createShapeField({
  profile: createShapeField({ name: createField("") }),
  slug: createField("s"),
});
type _nestedState = Expect<
  Equal<
    StoreValue<typeof nested.state>,
    { profile: { name: string }; slug: string }
  >
>;
type _nestedErrors = Expect<
  Equal<
    StoreValue<typeof nested.errors>,
    { profile: { name: FieldError }; slug: FieldError }
  >
>;

// ---------------------------------------------------------------------------
// Negative assertions (@ts-expect-error) — each next line MUST fail to compile
// ---------------------------------------------------------------------------

// fill payload must be a (partial) values object, not a scalar.
// @ts-expect-error string is not a partial values object
shape.fill("nope");

// fill values must match child value types.
// @ts-expect-error count must be a number
shape.fill({ count: "not a number" });

// add requires a `field` that is an AnyField.
// @ts-expect-error field must be a field contract
shape.add({ key: "x", field: "not a field" });

// add requires the `field` property.
// @ts-expect-error missing field
shape.add({ key: "x" });

// remove takes a key (string), not a number.
// @ts-expect-error number is not a valid key
shape.remove(123);

// validate is a void event — no payload.
// @ts-expect-error validate takes no payload
shape.validate("x");

// state value has a fixed shape — count is a number.
// @ts-expect-error count must be a number
const badState: StoreValue<typeof shape.state> = { title: "x", count: "1" };
void badState;

// setInnerErrors requires every key of the shape (no partial errors object).
// @ts-expect-error missing `count`
shape.setInnerErrors({ title: "bad" });

// raw values without options fall out of both overloads.
// @ts-expect-error raw values require an options object with createField
createShapeField({ title: "hi" });
