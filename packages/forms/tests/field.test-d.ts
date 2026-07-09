import {
  createField,
  type AnyField,
  type Field,
  type FieldError,
} from "@virentia/forms";
import type { Event, EventCallable, Store } from "@virentia/core";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// Factory return type + generic inference
// ---------------------------------------------------------------------------
const strField = createField("hi");
type _factoryString = Expect<Equal<typeof strField, Field<string>>>;

const numField = createField(5);
type _factoryNumber = Expect<Equal<typeof numField, Field<number>>>;

const boolField = createField(false);
type _factoryBool = Expect<Equal<typeof boolField, Field<boolean>>>;

// Meta defaults to Record<string, never> when omitted.
type _defaultMeta = Expect<Equal<typeof strField.meta, Store<Record<string, never>>>>;

// Explicit Meta generic flows into Field<Value, Meta> and meta: Store<Meta>.
const metaField = createField<string, { a: number; b?: string }>("", {
  meta: { a: 1 },
});
type _factoryWithMeta = Expect<
  Equal<typeof metaField, Field<string, { a: number; b?: string }>>
>;
type _metaStore = Expect<Equal<typeof metaField.meta, Store<{ a: number; b?: string }>>>;

// Value inferred from a structured initial.
const objField = createField<{ n: number }>({ n: 0 });
type _objValue = Expect<Equal<ReturnType<typeof objField.read>, { n: number }>>;

// options.error / validate / validationStrategies do not change the return type.
const optioned = createField("", {
  error: "seed",
  validate: (v: string) => (v ? null : "Required"),
  validationStrategies: ["change", "blur"],
});
type _optionedReturn = Expect<Equal<typeof optioned, Field<string>>>;

// ---------------------------------------------------------------------------
// State + error stores
// ---------------------------------------------------------------------------
type _state = Expect<Equal<typeof strField.state, Store<string>>>;
type _numState = Expect<Equal<typeof numField.state, Store<number>>>;

type _error = Expect<Equal<typeof strField.error, Store<FieldError>>>;
type _innerError = Expect<Equal<typeof strField.innerError, Store<FieldError>>>;
type _outerError = Expect<Equal<typeof strField.outerError, Store<FieldError>>>;

// Aliases share the exact same store types.
type _errorsAlias = Expect<Equal<typeof strField.errors, Store<FieldError>>>;
type _innerErrorsAlias = Expect<Equal<typeof strField.innerErrors, Store<FieldError>>>;
type _outerErrorsAlias = Expect<Equal<typeof strField.outerErrors, Store<FieldError>>>;

type _isValid = Expect<Equal<typeof strField.isValid, Store<boolean>>>;
type _isFocused = Expect<Equal<typeof strField.isFocused, Store<boolean>>>;
type _isPending = Expect<Equal<typeof strField.isValidationPending, Store<boolean>>>;

// ---------------------------------------------------------------------------
// Read / serialize / fill / reset / readFields
// ---------------------------------------------------------------------------
type _read = Expect<Equal<ReturnType<typeof strField.read>, string>>;
type _fillParams = Expect<Equal<Parameters<typeof strField.fill>, [string]>>;
type _fillReturn = Expect<Equal<ReturnType<typeof strField.fill>, Promise<void>>>;
type _resetParams = Expect<Equal<Parameters<typeof strField.reset>, []>>;
type _resetReturn = Expect<Equal<ReturnType<typeof strField.reset>, Promise<void>>>;
// `serialize` is inherited as optional from FieldContract, hence NonNullable.
type _serialize = Expect<
  Equal<
    ReturnType<NonNullable<typeof strField.serialize>>,
    { value: string; errors: FieldError }
  >
>;
type _readFields = Expect<
  Equal<ReturnType<typeof strField.readFields>, Readonly<Record<string, AnyField>>>
>;

type _setInnerErrorsParams = Expect<
  Equal<Parameters<typeof strField.setInnerErrors>, [FieldError]>
>;
type _setOuterErrorsParams = Expect<
  Equal<Parameters<typeof strField.setOuterErrors>, [FieldError]>
>;
type _setInnerErrorsReturn = Expect<
  Equal<ReturnType<typeof strField.setInnerErrors>, Promise<void>>
>;
type _clearInnerParams = Expect<Equal<Parameters<typeof strField.clearInnerErrors>, []>>;
type _clearOuterReturn = Expect<
  Equal<ReturnType<typeof strField.clearOuterErrors>, Promise<void>>
>;

// ---------------------------------------------------------------------------
// Event / event-callable payload types
// ---------------------------------------------------------------------------
type _change = Expect<Equal<typeof strField.change, EventCallable<string>>>;
type _changed = Expect<Equal<typeof strField.changed, Event<string>>>;
type _validate = Expect<Equal<typeof strField.validate, EventCallable<void>>>;
type _validated = Expect<Equal<typeof strField.validated, Event<string>>>;
type _validationFailed = Expect<Equal<typeof strField.validationFailed, Event<string>>>;
type _focus = Expect<Equal<typeof strField.focus, EventCallable<void>>>;
type _focused = Expect<Equal<typeof strField.focused, Event<void>>>;
type _blur = Expect<Equal<typeof strField.blur, EventCallable<void>>>;
type _blurred = Expect<Equal<typeof strField.blurred, Event<void>>>;
type _changeError = Expect<Equal<typeof strField.changeError, EventCallable<FieldError>>>;
type _setInnerError = Expect<
  Equal<typeof strField.setInnerError, EventCallable<FieldError>>
>;
type _setOuterError = Expect<
  Equal<typeof strField.setOuterError, EventCallable<FieldError>>
>;
type _errorsChanged = Expect<Equal<typeof strField.errorsChanged, Event<FieldError>>>;
type _changeMeta = Expect<
  Equal<typeof metaField.changeMeta, EventCallable<{ a: number; b?: string }>>
>;

// `kind` is the widened string of the contract, not a literal.
type _kind = Expect<Equal<typeof strField.kind, string>>;

// ---------------------------------------------------------------------------
// Negative assertions (@ts-expect-error)
// ---------------------------------------------------------------------------

// @ts-expect-error — fill requires the field's Value type.
strField.fill(123);

// @ts-expect-error — change carries the Value payload, not a number.
strField.change(123);

// @ts-expect-error — read() result is a string, not assignable to number.
const _wrongRead: number = strField.read();

// @ts-expect-error — meta is typed by the Meta generic; wrong shape rejected.
metaField.changeMeta({ a: "not-a-number" });

// @ts-expect-error — changeMeta must be the WHOLE Meta (missing required `a`).
metaField.changeMeta({ b: "x" });

// @ts-expect-error — changeError takes FieldError (string | null), not a number.
strField.changeError(123);

// @ts-expect-error — setInnerError takes FieldError, not a number.
strField.setInnerError(123);

// @ts-expect-error — setOuterError takes FieldError, not a number.
strField.setOuterError(123);

// @ts-expect-error — setInnerErrors takes FieldError, not a number.
strField.setInnerErrors(123);

// @ts-expect-error — focus is a void-payload event; passing an argument is invalid.
strField.focus("nope");

// @ts-expect-error — blur is a void-payload event; passing an argument is invalid.
strField.blur("nope");

// @ts-expect-error — validate is a void-payload event; passing an argument is invalid.
strField.validate("nope");

// @ts-expect-error — a number field rejects a string fill.
numField.fill("string");
