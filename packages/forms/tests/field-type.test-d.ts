import {
  defineField,
  fieldType,
  createField,
  type Field,
  type FieldType,
  type FieldContract,
} from "@virentia/forms";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

// --- defineField<F>(f: F): F -------------------------------------------------
// The return type is exactly the input type (identity at the type level).

const rangeField = {
  kind: "range" as const,
  state: createField({ start: 0 }).state,
  async fill(_next: { start: number }): Promise<void> {},
  async reset(): Promise<void> {},
  read() {
    return { start: 0 };
  },
} satisfies FieldContract<{ start: number }, { start: string | null }, { start: number }>;

const definedRange = defineField(rangeField);
type _defineReturnsInput = Expect<Equal<typeof definedRange, typeof rangeField>>;

// The input is constrained to AnyField.
const realField = createField("hello");
const definedReal = defineField(realField);
type _defineFieldIdentity = Expect<Equal<typeof definedReal, Field<string>>>;

// @ts-expect-error — a value that is not a field contract is rejected.
defineField(123);

// @ts-expect-error — an object missing the field contract shape is rejected.
defineField({ notAField: true });

// --- fieldType({ create }) : FieldType<Factory> ------------------------------

const numberType = fieldType({
  create: (initial: number) => createField(initial),
});
type _fieldTypeIsFactoryPlusExtend = Expect<
  Equal<typeof numberType, FieldType<(initial: number) => Field<number>>>
>;

// The callable preserves the factory's parameters and (wrapped) return type.
const numberInstance = numberType(5);
type _callableReturn = Expect<Equal<typeof numberInstance, Field<number>>>;

// @ts-expect-error — wrong argument type to the callable factory.
numberType("not a number");

// @ts-expect-error — missing required argument.
numberType();

// `kind` in the config is accepted at the type level (runtime-ignored, G-7).
const withKind = fieldType({
  kind: "ignored-at-runtime",
  create: (initial: string) => createField(initial),
});
type _withKindReturn = Expect<
  Equal<typeof withKind, FieldType<(initial: string) => Field<string>>>
>;

// @ts-expect-error — create is required in the config.
fieldType({ kind: "x" });

// @ts-expect-error — a create that does not return a field is rejected.
fieldType({ create: (n: number) => n });

// --- .extend generics --------------------------------------------------------

const trimmed = numberType.extend({
  create(base, initial: number) {
    // `base` is the parent factory typed as (initial: number) => Field<number>.
    const field = base(initial);
    return defineField({ ...field, kind: "trimmed", async trim(): Promise<void> {} });
  },
});

// extend yields a new FieldType whose factory has the extension's args and
// return type.
const trimmedInstance = trimmed(1);
type _extendHasTrim = Expect<Equal<typeof trimmedInstance.trim, () => Promise<void>>>;

// extend is chainable and re-parameterizes the args.
const relabelled = numberType.extend({
  create(base, label: string, initial: number) {
    return defineField({ ...base(initial), kind: label });
  },
});
const relabelledInstance = relabelled("tag", 3);
// The value type flows through the re-parameterized factory.
type _extendReparamsArgs = Expect<
  Equal<ReturnType<typeof relabelledInstance.read>, number>
>;

// @ts-expect-error — the extended callable now requires (string, number).
relabelled(3);

// @ts-expect-error — the extension's `create` must accept the base factory first.
numberType.extend({ create(initial: number) {
  return createField(initial);
} });

// `base` inside extend has the parent factory's exact call signature.
numberType.extend({
  create(base) {
    // @ts-expect-error — base expects a number, not a string.
    base("wrong");
    return createField(0);
  },
});
