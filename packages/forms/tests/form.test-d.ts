import {
  createField,
  createForm,
  type Field,
  type FieldError,
  type Form,
  type FormProjection,
  type NormalizeSchema,
  type PartialRecursive,
  type PickSchema,
  type SchemaErrors,
  type SchemaValues,
} from "@virentia/forms";
import type { Event, Store } from "@virentia/core";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;
type StoreValue<S> = S extends Store<infer T> ? T : never;
type EventPayload<E> = E extends Event<infer T> ? T : never;

// ---------------------------------------------------------------------------
// Reference schema (mixed: primitive / number / array / Date / nested group)
// ---------------------------------------------------------------------------
type Schema = {
  name: string;
  age: number;
  tags: string[];
  when: Date;
  profile: { email: string; nested: { city: string } };
};

declare const form: Form<Schema>;

// --- factory return type -----------------------------------------------------
const inferred = createForm({
  schema: {
    name: "",
    age: 0,
    tags: [] as string[],
    when: new Date(),
    profile: { email: "", nested: { city: "" } },
  },
});
type _returns = Expect<Equal<typeof inferred, Form<Schema>>>;

// --- SchemaValues mapping ----------------------------------------------------
type _values = Expect<
  Equal<
    SchemaValues<Schema>,
    {
      name: string;
      age: number;
      tags: string[];
      when: Date;
      profile: { email: string; nested: { city: string } };
    }
  >
>;
type _valuesStore = Expect<
  Equal<StoreValue<typeof form.values>, SchemaValues<Schema>>
>;
// value is an alias of values (same store payload)
type _valueAlias = Expect<
  Equal<StoreValue<typeof form.value>, SchemaValues<Schema>>
>;
type _snapshot = Expect<
  Equal<StoreValue<typeof form.snapshot>, SchemaValues<Schema>>
>;

// --- SchemaErrors mapping ----------------------------------------------------
type _errors = Expect<
  Equal<
    SchemaErrors<Schema>,
    {
      name: FieldError;
      age: FieldError;
      tags: FieldError;
      when: FieldError;
      profile: { email: FieldError; nested: { city: FieldError } };
    }
  >
>;
type _errorsStore = Expect<
  Equal<StoreValue<typeof form.errors>, SchemaErrors<Schema>>
>;
type _innerErrors = Expect<
  Equal<StoreValue<typeof form.innerErrors>, SchemaErrors<Schema>>
>;
type _outerErrors = Expect<
  Equal<StoreValue<typeof form.outerErrors>, SchemaErrors<Schema>>
>;

// --- boolean stores ----------------------------------------------------------
type _isChanged = Expect<Equal<StoreValue<typeof form.isChanged>, boolean>>;
type _isValid = Expect<Equal<StoreValue<typeof form.isValid>, boolean>>;
type _isPending = Expect<
  Equal<StoreValue<typeof form.isValidationPending>, boolean>
>;

// --- NormalizeSchema (fields) ------------------------------------------------
type _fields = Expect<Equal<typeof form.fields, NormalizeSchema<Schema>>>;
type _fieldName = Expect<Equal<NormalizeSchema<Schema>["name"], Field<string>>>;
type _fieldTags = Expect<
  Equal<NormalizeSchema<Schema>["tags"], Field<string[]>>
>;
type _fieldWhen = Expect<Equal<NormalizeSchema<Schema>["when"], Field<Date>>>;
type _fieldGroup = Expect<
  Equal<
    NormalizeSchema<Schema>["profile"],
    { email: Field<string>; nested: { city: Field<string> } }
  >
>;

// --- event payload types -----------------------------------------------------
type _filled = Expect<
  Equal<EventPayload<typeof form.filled>, SchemaValues<Schema>>
>;
type _changed = Expect<
  Equal<EventPayload<typeof form.changed>, SchemaValues<Schema>>
>;
type _errorsChanged = Expect<
  Equal<EventPayload<typeof form.errorsChanged>, SchemaErrors<Schema>>
>;
type _validated = Expect<
  Equal<EventPayload<typeof form.validated>, SchemaValues<Schema>>
>;
type _submitted = Expect<
  Equal<EventPayload<typeof form.submitted>, SchemaValues<Schema>>
>;
type _validatedAndSubmitted = Expect<
  Equal<EventPayload<typeof form.validatedAndSubmitted>, SchemaValues<Schema>>
>;

// --- fill / persist payloads (partial-recursive) -----------------------------
type _fillParam = Expect<
  Equal<
    Parameters<typeof form.fill>[0],
    {
      values?: PartialRecursive<SchemaValues<Schema>>;
      errors?: PartialRecursive<SchemaErrors<Schema>>;
    }
  >
>;
type _persistParam = Expect<
  Equal<
    Parameters<typeof form.persist>[0],
    {
      values: PartialRecursive<SchemaValues<Schema>>;
      errors?: PartialRecursive<SchemaErrors<Schema>>;
    }
  >
>;

// --- method return types -----------------------------------------------------
type _fillReturn = Expect<Equal<ReturnType<typeof form.fill>, Promise<void>>>;
type _resetReturn = Expect<Equal<ReturnType<typeof form.reset>, Promise<void>>>;
type _readReturn = Expect<Equal<ReturnType<typeof form.read>, SchemaValues<Schema>>>;
type _serializeReturn = Expect<
  Equal<
    ReturnType<typeof form.serialize>,
    { values: SchemaValues<Schema>; errors: SchemaErrors<Schema> }
  >
>;

// --- pick projection types ---------------------------------------------------
const leafPick = form.pick({ name: true });
type _leafPick = Expect<
  Equal<
    typeof leafPick,
    FormProjection<PickSchema<NormalizeSchema<Schema>, { name: true }>>
  >
>;
type _leafPickValues = Expect<
  Equal<StoreValue<(typeof leafPick)["values"]>, { name: string }>
>;

const groupPick = form.pick({ profile: { email: true } });
type _groupPickValues = Expect<
  Equal<
    StoreValue<(typeof groupPick)["values"]>,
    { profile: { email: string } }
  >
>;

const deepPick = form.pick({ profile: { nested: { city: true } } });
type _deepPickValues = Expect<
  Equal<
    StoreValue<(typeof deepPick)["values"]>,
    { profile: { nested: { city: string } } }
  >
>;

const wholeGroupPick = form.pick({ profile: true });
type _wholeGroupValues = Expect<
  Equal<
    StoreValue<(typeof wholeGroupPick)["values"]>,
    { profile: { email: string; nested: { city: string } } }
  >
>;

// --- createField generic inference used inside a schema ----------------------
const metaForm = createForm({
  schema: { flag: createField(false, { meta: { touched: true } }) },
});
type _metaFieldValue = Expect<
  Equal<StoreValue<(typeof metaForm)["values"]>, { flag: boolean }>
>;

// ===========================================================================
// Negative assertions — each @ts-expect-error line MUST fail to typecheck
// ===========================================================================

// fill: wrong value type for a numeric field
// @ts-expect-error age must be a number
form.fill({ values: { age: "not a number" } });

// fill: excess/unknown key not in schema
// @ts-expect-error `nope` is not part of the schema
form.fill({ values: { nope: 1 } });

// fill: wrong error type (errors must be FieldError, not number)
// @ts-expect-error name error must be string | null
form.fill({ errors: { name: 123 } });

// fill: wrong nested error shape (nested group expects an object, not a scalar)
// @ts-expect-error profile is a group; a bare string is not its error shape
form.fill({ errors: { profile: "bad" } });

// persist: values is required
// @ts-expect-error persist requires a `values` key
form.persist({ errors: { name: "x" } });

// pick: selection value must be `true` (or a nested selection), not an arbitrary string
// @ts-expect-error "yes" is not a valid selection value
form.pick({ name: "yes" });

// pick: unknown key in selection
// @ts-expect-error `missing` is not a schema key
form.pick({ missing: true });

// submit is a void event — passing a payload is an error
// @ts-expect-error submit takes no argument
form.submit(123);

// validate is a void event — passing a payload is an error
// @ts-expect-error validate takes no argument
form.validate("now");

// reading a boolean store's payload as the wrong type
// @ts-expect-error isChanged payload is boolean, not string
const _wrongScalar: string = form.isChanged.value;

// createForm requires a schema
// @ts-expect-error schema is required
createForm({});
