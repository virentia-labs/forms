import {
  createArrayField,
  createField,
  createShapeField,
  type ArrayField,
  type ArrayFieldErrors,
  type Field,
  type FieldError,
  type ShapeField,
} from "@virentia/forms";
import type { Event, Store } from "@virentia/core";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// Factory return type + generic inference
// ---------------------------------------------------------------------------
const tags = createArrayField(["a", "b"]);
type Tags = typeof tags;

type _returnDefault = Expect<Equal<Tags, ArrayField<string, Field<string>>>>;
type _returnDefaultAlias = Expect<Equal<Tags, ArrayField<string>>>;

const nums = createArrayField([1, 2, 3]);
type _numsReturn = Expect<Equal<typeof nums, ArrayField<number, Field<number>>>>;
type _numsState = Expect<
  Equal<typeof nums.state, Store<readonly number[]>>
>;

// explicit generic parameters
const explicit = createArrayField<number, Field<number>>([1]);
type _explicit = Expect<Equal<typeof explicit, ArrayField<number, Field<number>>>>;

// empty default -> unknown value
const empty = createArrayField<boolean>();
type _empty = Expect<Equal<typeof empty, ArrayField<boolean, Field<boolean>>>>;

// custom item field via createItem inference
const people = createArrayField([{ name: "" }], {
  createItem(value) {
    return createShapeField({ name: createField(value.name) });
  },
});
type _peopleItem =
  typeof people.items extends Store<readonly (infer I)[]> ? I : never;
type _peopleItemIsShape = Expect<
  Equal<_peopleItem, ShapeField<{ name: Field<string> }>>
>;

// ---------------------------------------------------------------------------
// Store shapes
// ---------------------------------------------------------------------------
type _state = Expect<Equal<typeof tags.state, Store<readonly string[]>>>;
type _items = Expect<Equal<typeof tags.items, Store<readonly Field<string>[]>>>;
type _itemFields = Expect<
  Equal<typeof tags.itemFields, Store<Readonly<Record<string, Field<string>>>>>
>;
type _length = Expect<Equal<typeof tags.length, Store<number>>>;
type _isValid = Expect<Equal<typeof tags.isValid, Store<boolean>>>;
type _isValidationPending = Expect<
  Equal<typeof tags.isValidationPending, Store<boolean>>
>;

// error stores use ArrayFieldErrors<FieldError>
type _errors = Expect<
  Equal<typeof tags.errors, Store<ArrayFieldErrors<FieldError>>>
>;
type _innerErrors = Expect<
  Equal<typeof tags.innerErrors, Store<ArrayFieldErrors<FieldError>>>
>;
type _outerErrors = Expect<
  Equal<typeof tags.outerErrors, Store<ArrayFieldErrors<FieldError>>>
>;

// the item field extracted from `items`
type Item = typeof tags.items extends Store<readonly (infer I)[]> ? I : never;
type _item = Expect<Equal<Item, Field<string>>>;

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------
type _changed = Expect<Equal<typeof tags.changed, Event<readonly string[]>>>;
type _validated = Expect<Equal<typeof tags.validated, Event<readonly string[]>>>;
type _validationFailed = Expect<
  Equal<typeof tags.validationFailed, Event<readonly string[]>>
>;
type _errorsChanged = Expect<
  Equal<typeof tags.errorsChanged, Event<ArrayFieldErrors<FieldError>>>
>;

// ---------------------------------------------------------------------------
// Method parameter + return types
// ---------------------------------------------------------------------------
type _pushInput = Expect<
  Equal<Parameters<Tags["push"]>[0], string | Field<string>>
>;
type _pushReturn = Expect<Equal<ReturnType<Tags["push"]>, Promise<void>>>;
type _unshiftInput = Expect<
  Equal<Parameters<Tags["unshift"]>[0], string | Field<string>>
>;
type _insertIndex = Expect<Equal<Parameters<Tags["insert"]>[0], number>>;
type _insertInput = Expect<
  Equal<Parameters<Tags["insert"]>[1], string | Field<string>>
>;
type _removeIndex = Expect<Equal<Parameters<Tags["remove"]>[0], number>>;
type _replaceIndex = Expect<Equal<Parameters<Tags["replace"]>[0], number>>;
type _replaceInput = Expect<
  Equal<Parameters<Tags["replace"]>[1], string | Field<string>>
>;
type _moveParams = Expect<Equal<Parameters<Tags["move"]>, [from: number, to: number]>>;
type _swapParams = Expect<
  Equal<Parameters<Tags["swap"]>, [first: number, second: number]>
>;
type _popReturn = Expect<Equal<ReturnType<Tags["pop"]>, Promise<void>>>;
type _clearReturn = Expect<Equal<ReturnType<Tags["clear"]>, Promise<void>>>;
type _fillInput = Expect<Equal<Parameters<Tags["fill"]>[0], readonly string[]>>;
type _readReturn = Expect<Equal<ReturnType<Tags["read"]>, readonly string[]>>;
type _setInnerInput = Expect<
  Equal<Parameters<Tags["setInnerErrors"]>[0], ArrayFieldErrors<FieldError>>
>;
type _setOuterInput = Expect<
  Equal<Parameters<Tags["setOuterErrors"]>[0], ArrayFieldErrors<FieldError>>
>;

// createItem callback param types
createArrayField(["a"], {
  createItem(value, index) {
    type _valueIsString = Expect<Equal<typeof value, string>>;
    type _indexIsNumber = Expect<Equal<typeof index, number>>;
    return createField(value);
  },
});

// ---------------------------------------------------------------------------
// Positive usages (must type-check with no error)
// ---------------------------------------------------------------------------
void tags.push("ok");
void tags.push(createField("ok"));
void tags.insert(0, "ok");
void tags.replace(0, createField("ok"));
void tags.remove(0);
void tags.move(0, 1);
void tags.swap(0, 1);
void tags.fill(["a", "b"]);
void tags.setInnerErrors([null, "err"]);
void tags.setInnerErrors("scalar");
void tags.setOuterErrors(["err", null]);
const _okStateType: Store<readonly string[]> = tags.state;
void _okStateType;

// ---------------------------------------------------------------------------
// Negative assertions (each next line MUST be a type error)
// ---------------------------------------------------------------------------
// @ts-expect-error push value must be string | Field<string>, not a number
void tags.push(123);
// @ts-expect-error unshift value must be string | Field<string>
void tags.unshift(true);
// @ts-expect-error remove index must be a number
void tags.remove("x");
// @ts-expect-error insert index must be a number
void tags.insert("0", "v");
// @ts-expect-error insert value must be string | Field<string>
void tags.insert(0, 123);
// @ts-expect-error replace value must be string | Field<string>
void tags.replace(0, 123);
// @ts-expect-error move indices must be numbers
void tags.move(0, "1");
// @ts-expect-error swap indices must be numbers
void tags.swap("0", 1);
// @ts-expect-error fill expects readonly string[], not number[]
void tags.fill([1, 2]);
// @ts-expect-error state holds readonly string[], not readonly number[]
const _badState: Store<readonly number[]> = tags.state;
void _badState;
// @ts-expect-error pushing the wrong field-item type is rejected
void tags.push(createField(123));
