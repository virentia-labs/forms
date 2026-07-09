import {
  createArrayField,
  createField,
  createShapeField,
  normalizeField,
  readStoreSnapshot,
  type ArrayField,
  type Field,
  type FieldContract,
  type FieldError,
  type NormalizedField,
  type ShapeField,
} from "@virentia/forms";
import type { EventCallable, Store, StoreWritable } from "@virentia/core";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

// ===========================================================================
// readStoreSnapshot<T>(Store<T> | StoreWritable<T>): T
// ===========================================================================
declare const numStore: Store<number>;
declare const arrStore: Store<readonly string[]>;
declare const objStore: StoreWritable<{ a: number; b: string }>;

const scalar = readStoreSnapshot(numStore);
type _rsScalar = Expect<Equal<typeof scalar, number>>;

const arr = readStoreSnapshot(arrStore);
type _rsArray = Expect<Equal<typeof arr, readonly string[]>>;

const obj = readStoreSnapshot(objStore);
type _rsObject = Expect<Equal<typeof obj, { a: number; b: string }>>;

// Explicit type argument threads straight through to the return type.
type _rsReturn = Expect<Equal<ReturnType<typeof readStoreSnapshot<Date>>, Date>>;

// @ts-expect-error readStoreSnapshot requires a store, not a bare number
readStoreSnapshot(123);

// @ts-expect-error readStoreSnapshot requires an argument
readStoreSnapshot();

// ===========================================================================
// createField generic inference (createField<Value, Meta>)
// ===========================================================================
const field = createField("hi");
type _fieldType = Expect<Equal<typeof field, Field<string>>>;
type _fieldState = Expect<Equal<typeof field.state, Store<string>>>;
type _fieldError = Expect<Equal<typeof field.error, Store<FieldError>>>;
type _fieldChange = Expect<Equal<typeof field.change, EventCallable<string>>>;
type _fieldReadReturn = Expect<Equal<ReturnType<typeof field.read>, string>>;

const numberField = createField(0);
type _numberFieldType = Expect<Equal<typeof numberField, Field<number>>>;

const metaField = createField("x", { meta: { touched: false } });
type _metaStore = Expect<Equal<typeof metaField.meta, Store<{ touched: boolean }>>>;
type _metaChange = Expect<
  Equal<typeof metaField.changeMeta, EventCallable<{ touched: boolean }>>
>;

// @ts-expect-error change expects a string payload, not a number
field.change(123);

// @ts-expect-error change requires a payload
field.change();

// @ts-expect-error the error store payload is FieldError, not number
const _wrongScalar: number = field.error.value;

// @ts-expect-error createField requires an initial value
createField();

// ===========================================================================
// createArrayField generic inference (createArrayField<Value, ItemField>)
// ===========================================================================
const tags = createArrayField(["a", "b"]);
type _arrType = Expect<Equal<typeof tags, ArrayField<string>>>;
type _arrState = Expect<Equal<typeof tags.state, Store<readonly string[]>>>;
type _arrLength = Expect<Equal<typeof tags.length, Store<number>>>;
type _arrItems = Expect<Equal<typeof tags.items, Store<readonly Field<string>[]>>>;

tags.push("ok");
tags.insert(0, "ok");

// @ts-expect-error push expects a string item (or item field), not a number
tags.push(123);

// ===========================================================================
// createShapeField generic inference
// ===========================================================================
const shape = createShapeField({ name: createField(""), age: createField(0) });
type _shapeType = Expect<
  Equal<typeof shape, ShapeField<{ name: Field<string>; age: Field<number> }>>
>;
type _shapeState = Expect<
  Equal<typeof shape.state, Store<{ name: string; age: number }>>
>;

// ===========================================================================
// normalizeField typing
// ===========================================================================
declare const contract: FieldContract<number, string | null, boolean>;
const normalized = normalizeField(contract);

type _normType = Expect<
  Equal<typeof normalized, NormalizedField<number, string | null, boolean>>
>;
type _normErrors = Expect<Equal<typeof normalized.errors, Store<string | null>>>;
type _normInnerErrors = Expect<
  Equal<typeof normalized.innerErrors, Store<string | null>>
>;
type _normOuterErrors = Expect<
  Equal<typeof normalized.outerErrors, Store<string | null>>
>;
type _normIsValid = Expect<Equal<typeof normalized.isValid, Store<boolean>>>;
type _normValidate = Expect<Equal<typeof normalized.validate, EventCallable<void>>>;
type _normFillParam = Expect<Equal<Parameters<typeof normalized.fill>[0], boolean>>;
type _normReadReturn = Expect<Equal<ReturnType<typeof normalized.read>, number>>;
type _normSetInner = Expect<
  Equal<Parameters<typeof normalized.setInnerErrors>[0], string | null>
>;

// A real field passed through normalizeField keeps its concrete field shape.
const normalizedField = normalizeField(field);
type _normFieldReadReturn = Expect<
  Equal<ReturnType<typeof normalizedField.read>, string>
>;

// @ts-expect-error normalizeField requires a field contract, not an empty object
normalizeField({});

// @ts-expect-error validate is a void event — it takes no payload
normalized.validate(5);

// @ts-expect-error fill expects the Fill type (boolean), not a string
normalized.fill("nope");

// @ts-expect-error normalizeField requires an argument
normalizeField();
