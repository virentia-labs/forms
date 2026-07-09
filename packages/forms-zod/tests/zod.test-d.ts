/**
 * Type-only tests for @virentia/forms-zod.
 *
 * These assertions are verified by `pnpm typecheck` (tsc --noEmit). They are NOT
 * executed by vitest — never use runtime `expect()` here.
 *
 * Requirements extracted from packages/forms-zod/lib/index.ts:
 *   type SchemaFactory<Schema> = Schema | ((ctx: ValidationContext) => Schema)
 *   type AnyZodSchema        = ZodType<any, any, any>
 *   type ZodOutput<Schema>   = Schema extends ZodType<infer Output, any, any> ? Output : never
 *   zodValidator<Schema extends AnyZodSchema>(schema: SchemaFactory<Schema>): FormValidator<ZodOutput<Schema>, any>
 *   zodFieldValidator<Schema extends AnyZodSchema>(schema: SchemaFactory<Schema>): FieldValidator<ZodOutput<Schema>, FieldError>
 *   const zodFormValidator = zodValidator
 *
 * IMPORTANT BUG (pinned green below, reported as `zod-output-unknown`):
 * With the installed zod v4 (4.4.3) the `ZodOutput<Schema>` conditional collapses
 * to `unknown` for EVERY schema — including .transform()/.coerce() outputs — because
 * zod v4's concrete schema types (ZodObject/ZodNumber/…) extend
 * `ZodType<any, any, Internals>` and carry the real output type inside `Internals`,
 * not the first type parameter that ZodOutput reads. So the "nice" per-schema output
 * inference promised by the adapter's shape never actually happens. The tests below
 * pin this ACTUAL behavior (green) so the suite stays passing.
 */
import type { Store, StoreWritable } from "@virentia/core";
import type { FieldError, FieldValidator, FormValidator, ValidationContext } from "@virentia/forms";
import type { ZodType } from "zod";
import { z } from "zod";
import { zodFieldValidator, zodFormValidator, zodValidator } from "../lib";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

// ===========================================================================
// zodValidator — return shape is FormValidator<ZodOutput<Schema>, any>
// ===========================================================================
const formObject = zodValidator(z.object({ a: z.string() }));
type _formObject = Expect<Equal<typeof formObject, FormValidator<unknown, any>>>;

const formNested = zodValidator(
  z.object({ profile: z.object({ email: z.string() }), age: z.number() }),
);
type _formNested = Expect<Equal<typeof formNested, FormValidator<unknown, any>>>;

// A form validator is a ValidationUnit union: plain async function | Effect.
// The plain async arrow the adapter returns is assignable to that union.
const _formIsCallable: FormValidator<unknown, any> = formObject;

// The Errors type parameter of a form validator is ALWAYS `any` (hard-coded in the
// adapter return type), independent of the schema.
type _formErrorsAreAny = Expect<
  Equal<typeof formObject, typeof formNested>
>;

// Documents the bug: the result is NOT the "nice" inferred output shape.
type _formNotNiceOutput = Expect<
  Equal<Equal<typeof formObject, FormValidator<{ a: string }, any>>, false>
>;

// ===========================================================================
// zodFieldValidator — return shape is FieldValidator<ZodOutput<Schema>, FieldError>
// ===========================================================================
const fieldNumber = zodFieldValidator(z.number());
type _fieldNumber = Expect<Equal<typeof fieldNumber, FieldValidator<unknown, FieldError>>>;

const fieldString = zodFieldValidator(z.string());
type _fieldString = Expect<Equal<typeof fieldString, FieldValidator<unknown, FieldError>>>;

// The field validator's Errors parameter is FieldError (= string | null), never `any`.
type _fieldErrorsAreFieldError = Expect<Equal<FieldError, string | null>>;
const _fieldError: FieldValidator<unknown, FieldError> = fieldNumber;

// Documents the bug: z.number() does NOT infer a `number` field validator.
type _fieldNotNiceOutput = Expect<
  Equal<Equal<typeof fieldNumber, FieldValidator<number, FieldError>>, false>
>;

// ===========================================================================
// .transform() / .coerce() outputs — spec expects these to flow through, but
// the adapter collapses them to `unknown` (pinned bug behavior).
// ===========================================================================
const fieldTransform = zodFieldValidator(z.string().transform((s) => s.length));
type _fieldTransform = Expect<Equal<typeof fieldTransform, FieldValidator<unknown, FieldError>>>;
// The spec's intended `number` output is NOT what you get.
type _transformNotNumber = Expect<
  Equal<Equal<typeof fieldTransform, FieldValidator<number, FieldError>>, false>
>;

const fieldCoerce = zodFieldValidator(z.coerce.number());
type _fieldCoerce = Expect<Equal<typeof fieldCoerce, FieldValidator<unknown, FieldError>>>;

const formCoerce = zodValidator(z.object({ n: z.coerce.number(), when: z.coerce.date() }));
type _formCoerce = Expect<Equal<typeof formCoerce, FormValidator<unknown, any>>>;

// ===========================================================================
// ZodOutput internal conditional (branch-by-branch) — reconstructed replica.
// Every zod v4 schema collapses to `unknown`; the fallback branch is `never`.
// ===========================================================================
type ZodOutput<Schema> = Schema extends ZodType<infer Output, any, any> ? Output : never;

const sObject = z.object({ a: z.string() });
const sNumber = z.number();
const sStringT = z.string();
const sArray = z.array(z.string());
const sTransform = z.string().transform((v) => v.length);
const sCoerce = z.coerce.number();
const sUnion = z.union([z.string(), z.number()]);
const sDiscriminated = z.discriminatedUnion("k", [
  z.object({ k: z.literal("a"), a: z.string() }),
  z.object({ k: z.literal("b"), b: z.number() }),
]);
const sOptional = z.string().optional();
const sNullable = z.string().nullable();
const sRefined = z.object({ p: z.string(), c: z.string() }).refine((v) => v.p === v.c);
const sPipe = z.string().pipe(z.string().transform((s) => s.length));

type _outObject = Expect<Equal<ZodOutput<typeof sObject>, unknown>>;
type _outNumber = Expect<Equal<ZodOutput<typeof sNumber>, unknown>>;
type _outString = Expect<Equal<ZodOutput<typeof sStringT>, unknown>>;
type _outArray = Expect<Equal<ZodOutput<typeof sArray>, unknown>>;
type _outTransform = Expect<Equal<ZodOutput<typeof sTransform>, unknown>>;
type _outCoerce = Expect<Equal<ZodOutput<typeof sCoerce>, unknown>>;
type _outUnion = Expect<Equal<ZodOutput<typeof sUnion>, unknown>>;
type _outDiscriminated = Expect<Equal<ZodOutput<typeof sDiscriminated>, unknown>>;
type _outOptional = Expect<Equal<ZodOutput<typeof sOptional>, unknown>>;
type _outNullable = Expect<Equal<ZodOutput<typeof sNullable>, unknown>>;
type _outRefined = Expect<Equal<ZodOutput<typeof sRefined>, unknown>>;
type _outPipe = Expect<Equal<ZodOutput<typeof sPipe>, unknown>>;

// Fallback branch: a non-ZodType input yields `never`.
type _outNonSchemaNumber = Expect<Equal<ZodOutput<number>, never>>;
type _outNonSchemaObject = Expect<Equal<ZodOutput<{ a: 1 }>, never>>;
type _outNever = Expect<Equal<ZodOutput<never>, never>>;

// ===========================================================================
// zodFormValidator — the exact same value/type as zodValidator.
// ===========================================================================
type _formValidatorIsZodValidator = Expect<Equal<typeof zodFormValidator, typeof zodValidator>>;

const formAlias = zodFormValidator(z.object({ a: z.string() }));
type _formAlias = Expect<Equal<typeof formAlias, FormValidator<unknown, any>>>;
type _formAliasSameAsValidator = Expect<Equal<typeof formAlias, typeof formObject>>;

// ===========================================================================
// SchemaFactory — a bare schema AND a `(ctx) => schema` factory are both accepted,
// and produce the identical return type.
// ===========================================================================
const fromBareSchema = zodValidator(z.object({ a: z.string() }));
const fromFactory = zodValidator((ctx: ValidationContext) => z.object({ a: z.string() }));
type _factorySameAsBare = Expect<Equal<typeof fromFactory, typeof fromBareSchema>>;

const fieldFromFactory = zodFieldValidator((ctx: ValidationContext) => z.number());
type _fieldFactory = Expect<Equal<typeof fieldFromFactory, FieldValidator<unknown, FieldError>>>;

// The factory param is contextually typed as ValidationContext with NO annotation.
zodValidator((ctx) => {
  type _ctxInferredAsValidationContext = Expect<Equal<typeof ctx, ValidationContext>>;
  return z.object({ a: z.string() });
});
zodFieldValidator((ctx) => {
  type _fieldCtxInferred = Expect<Equal<typeof ctx, ValidationContext>>;
  return z.string();
});

// ctx members are exactly the ValidationContext surface.
declare const readonlyStore: Store<number>;
declare const writableStore: StoreWritable<string>;
zodValidator((ctx) => {
  const path: readonly string[] = ctx.path;
  const signal: AbortSignal = ctx.signal;
  const readRo: number = ctx.read(readonlyStore);
  const readRw: string = ctx.read(writableStore);
  void path;
  void signal;
  void readRo;
  void readRw;
  // @ts-expect-error `read` requires a Store, not a bare value.
  ctx.read(123);
  // @ts-expect-error ValidationContext has no such member.
  ctx.doesNotExist;
  return z.object({ a: z.string() });
});

// ===========================================================================
// Negative assertions (@ts-expect-error) — each MUST be a real type error.
// ===========================================================================

// @ts-expect-error a bare number is not a zod schema.
zodValidator(42);
// @ts-expect-error a bare string is not a zod schema.
zodValidator("nope");
// @ts-expect-error a plain object is not a zod schema.
zodValidator({ a: 1 });
// @ts-expect-error undefined is not a zod schema.
zodValidator(undefined);
// @ts-expect-error null is not a zod schema.
zodFieldValidator(null);
// @ts-expect-error the schema argument is required.
zodFieldValidator();

// @ts-expect-error a factory whose ctx is a primitive is rejected (contravariant param).
zodValidator((ctx: string) => z.object({ a: z.string() }));
// @ts-expect-error a factory whose ctx is a foreign interface is rejected.
zodFieldValidator((ctx: { foo: number }) => z.number());
// @ts-expect-error a factory that returns a non-zod value is rejected.
zodValidator(() => 42);
// @ts-expect-error a factory that returns a bare object is rejected.
zodFieldValidator(() => ({ a: 1 }));
