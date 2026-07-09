import { describe, expect, it } from "vitest";
import { scope, scoped, store } from "@virentia/core";
import {
  createArrayField,
  createField,
  createForm,
  readStoreSnapshot,
} from "@virentia/forms";
import type { FieldError, ValidationContext } from "@virentia/forms";
import { z } from "zod";
import { zodFieldValidator, zodFormValidator, zodValidator } from "../lib";

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

async function tick(times = 1): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function makeCtx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    signal: new AbortController().signal,
    path: [],
    read: (unit) => readStoreSnapshot(unit),
    ...overrides,
  };
}

type FakeIssue = { path: readonly PropertyKey[]; message: string | undefined };
type FakeSpec = { success: true } | { success: false; issues: readonly FakeIssue[] };

// A minimal object exposing only `.safeParseAsync` — the sole method the adapter
// touches. Lets us drive `zodIssuesToErrors` / `setPathError` with fully
// controlled issue arrays (paths, ordering, exotic segments) that real zod would
// never emit, so every internal branch can be pinned deterministically.
function fakeSchema(spec: FakeSpec): any {
  return {
    async safeParseAsync() {
      if (spec.success) {
        return { success: true, data: {} };
      }
      return { success: false, error: { issues: spec.issues } };
    },
  };
}

type FormRun = (
  values: unknown,
  ctx: ValidationContext,
) => Promise<Record<string, unknown> | null>;

// Invoke the FormValidator returned by zodValidator directly (no scope needed:
// it only awaits `safeParseAsync`, an external boundary).
function runForm(
  schema: unknown,
  values: unknown = {},
  ctx: ValidationContext = makeCtx(),
): Promise<Record<string, unknown> | null> {
  return (zodValidator(schema as never) as unknown as FormRun)(values, ctx);
}

type FieldRun = (value: unknown, ctx: ValidationContext) => Promise<FieldError>;

function runField(
  schema: unknown,
  value: unknown,
  ctx: ValidationContext = makeCtx(),
): Promise<FieldError> {
  return (zodFieldValidator(schema as never) as unknown as FieldRun)(value, ctx);
}

// ---------------------------------------------------------------------------
// zodFormValidator
// ---------------------------------------------------------------------------

describe("zodFormValidator", () => {
  it("is the same reference as zodValidator", () => {
    expect(zodFormValidator).toBe(zodValidator);
  });
});

// ---------------------------------------------------------------------------
// zodValidator
// ---------------------------------------------------------------------------

describe("zodValidator", () => {
  describe("with a valid input", () => {
    it("returns null when a plain schema parses", async () => {
      expect(await runForm(z.object({ a: z.string() }), { a: "ok" })).toBeNull();
    });

    it("returns null for an empty object schema", async () => {
      expect(await runForm(z.object({}), {})).toBeNull();
    });

    it("ignores extra keys not declared on the schema", async () => {
      expect(await runForm(z.object({}), { unexpected: 1 })).toBeNull();
    });

    it("returns null for an absent optional field", async () => {
      expect(await runForm(z.object({ a: z.string().optional() }), {})).toBeNull();
    });

    it("returns null for a nullable field set to null", async () => {
      expect(
        await runForm(z.object({ a: z.string().nullable() }), { a: null }),
      ).toBeNull();
    });

    it("returns null for an absent field carrying a default", async () => {
      expect(await runForm(z.object({ a: z.string().default("x") }), {})).toBeNull();
    });

    it("returns null when the schema reports success", async () => {
      expect(await runForm(fakeSchema({ success: true }))).toBeNull();
    });

    it("yields an empty object, not null, for a failed parse with no issues", async () => {
      // success:false short-circuits the `if (result.success) return null` guard,
      // so zodIssuesToErrors runs over an empty list and returns an empty object.
      // The form layer then treats {} as no-errors, but the adapter itself does
      // not collapse it back to null. Pin the exact object.
      expect(await runForm(fakeSchema({ success: false, issues: [] }))).toEqual({});
    });
  });

  // zodIssuesToErrors + setPathError: branch-by-branch (via fake schema)
  describe("mapping issues to an error tree", () => {
    it("writes the _form key at the root for an empty path", async () => {
      const errors = await runForm(
        fakeSchema({ success: false, issues: [{ path: [], message: "root problem" }] }),
      );
      expect(errors).toEqual({ _form: "root problem" });
    });

    it("puts a single scalar leaf at a top-level key", async () => {
      const errors = await runForm(
        fakeSchema({ success: false, issues: [{ path: ["email"], message: "bad" }] }),
      );
      expect(errors).toEqual({ email: "bad" });
    });

    it("builds intermediate objects for a nested object path", async () => {
      const errors = await runForm(
        fakeSchema({
          success: false,
          issues: [{ path: ["profile", "email"], message: "bad email" }],
        }),
      );
      expect(errors).toEqual({ profile: { email: "bad email" } });
    });

    it("turns numeric array-index segments into string keys", async () => {
      const errors = await runForm(
        fakeSchema({ success: false, issues: [{ path: ["tags", 0], message: "idx0" }] }),
      );
      expect(errors).toEqual({ tags: { "0": "idx0" } });
    });

    it("turns a leading numeric segment into a string key at the root", async () => {
      const errors = await runForm(
        fakeSchema({ success: false, issues: [{ path: [0], message: "first" }] }),
      );
      expect(errors).toEqual({ "0": "first" });
    });

    it("turns purely numeric nested segments into nested string keys", async () => {
      const errors = await runForm(
        fakeSchema({ success: false, issues: [{ path: [1, 2], message: "deep" }] }),
      );
      expect(errors).toEqual({ "1": { "2": "deep" } });
    });

    it("lets a later root issue overwrite an earlier one", async () => {
      // Leaf paths guard with `if (!(key in cursor))` (first wins), but the
      // empty-path branch assigns `target._form = message` unconditionally, so a
      // later root issue OVERWRITES an earlier one. Reachable via real zod too
      // (two path-less superRefine issues).
      const errors = await runForm(
        fakeSchema({
          success: false,
          issues: [
            { path: [], message: "root-first" },
            { path: [], message: "root-last" },
          ],
        }),
      );
      expect(errors).toEqual({ _form: "root-last" });
    });

    it("keeps the first issue for a repeated leaf path", async () => {
      const errors = await runForm(
        fakeSchema({
          success: false,
          issues: [
            { path: ["x"], message: "first" },
            { path: ["x"], message: "second" },
          ],
        }),
      );
      expect(errors).toEqual({ x: "first" });
    });

    it("drops a later scalar when the key already holds an object", async () => {
      // issue A sets a.b (so `a` is now an object); issue B targets `a` as a leaf.
      // Last-segment guard `if (!(key in cursor))` sees `a` present -> B is ignored.
      const errors = await runForm(
        fakeSchema({
          success: false,
          issues: [
            { path: ["a", "b"], message: "nested" },
            { path: ["a"], message: "scalar-dropped" },
          ],
        }),
      );
      expect(errors).toEqual({ a: { b: "nested" } });
    });

    it("overwrites a scalar with {} when a later issue descends through it", async () => {
      // issue A sets `a` to a scalar; issue B needs to descend through `a`, so the
      // scalar is destructively replaced by {} and the earlier message is LOST.
      const errors = await runForm(
        fakeSchema({
          success: false,
          issues: [
            { path: ["a"], message: "scalar-lost" },
            { path: ["a", "b"], message: "nested" },
          ],
        }),
      );
      expect(errors).toEqual({ a: { b: "nested" } });
    });

    it("collects many distinct paths plus a root error in one pass", async () => {
      const errors = await runForm(
        fakeSchema({
          success: false,
          issues: [
            { path: ["a"], message: "a-err" },
            { path: ["b", "c"], message: "bc-err" },
            { path: [], message: "root-err" },
          ],
        }),
      );
      expect(errors).toEqual({
        a: "a-err",
        b: { c: "bc-err" },
        _form: "root-err",
      });
    });

    it("builds a fully nested tree for a five-level-deep path", async () => {
      const errors = await runForm(
        fakeSchema({
          success: false,
          issues: [{ path: ["l1", "l2", "l3", "l4", "l5"], message: "deep5" }],
        }),
      );
      expect(errors).toEqual({
        l1: { l2: { l3: { l4: { l5: "deep5" } } } },
      });
    });

    it("preserves unicode path segments verbatim as keys", async () => {
      const errors = await runForm(
        fakeSchema({
          success: false,
          issues: [{ path: ["café", "日本語", "🚀"], message: "u" }],
        }),
      );
      expect(errors).toEqual({ café: { "日本語": { "🚀": "u" } } });
    });

    it("keeps a dotted-looking segment as a single literal key", async () => {
      // setPathError does NOT split on '.', it uses the raw String(segment). Any
      // dotted-path expansion happens later, in the form layer, not the adapter.
      const errors = await runForm(
        fakeSchema({ success: false, issues: [{ path: ["a.b.c"], message: "dotted" }] }),
      );
      expect(errors).toEqual({ "a.b.c": "dotted" });
      expect(Object.keys(errors ?? {})).toEqual(["a.b.c"]);
    });

    it("coerces a symbol segment through String()", async () => {
      const sym = Symbol("weird");
      const errors = await runForm(
        fakeSchema({ success: false, issues: [{ path: [sym], message: "s" }] }),
      );
      expect(errors).toEqual({ [String(sym)]: "s" });
    });
  });

  describe("with real zod schemas", () => {
    it("keeps the first of multiple issues on one field", async () => {
      const errors = await runForm(
        z.object({ email: z.string().min(2, "len").email("email") }),
        { email: "1" },
      );
      expect(errors).toEqual({ email: "len" });
    });

    it("maps nested-object and array .min issues onto their keys", async () => {
      const errors = await runForm(
        z.object({
          age: z.number().min(18, "Too young"),
          tags: z.array(z.string()).min(2, "At least two tags"),
          profile: z.object({ email: z.string().email("Invalid email") }),
        }),
        { age: 0, tags: ["a"], profile: { email: "nope" } },
      );
      expect(errors).toEqual({
        age: "Too young",
        tags: "At least two tags",
        profile: { email: "Invalid email" },
      });
    });

    it("maps per-index array item issues to numeric string keys", async () => {
      const errors = await runForm(
        z.object({ tags: z.array(z.string().min(3, "item min")) }),
        { tags: ["a", "b"] },
      );
      expect(errors).toEqual({ tags: { "0": "item min", "1": "item min" } });
    });

    it("merges same-path (first wins), distinct paths, and a root superRefine issue into one tree", async () => {
      const schema = z.object({ a: z.string(), b: z.string() }).superRefine(
        (_value, ctx) => {
          ctx.addIssue({ code: "custom", message: "a1", path: ["a"] });
          ctx.addIssue({ code: "custom", message: "a2-dropped", path: ["a"] });
          ctx.addIssue({ code: "custom", message: "b1", path: ["b"] });
          ctx.addIssue({ code: "custom", message: "root" });
        },
      );
      const errors = await runForm(schema, { a: "x", b: "y" });
      expect(errors).toEqual({ a: "a1", b: "b1", _form: "root" });
    });

    it("targets a refine failure at its declared path", async () => {
      const schema = z
        .object({ password: z.string(), confirm: z.string() })
        .refine((v) => v.password === v.confirm, {
          message: "Passwords do not match",
          path: ["confirm"],
        });
      expect(await runForm(schema, { password: "a", confirm: "b" })).toEqual({
        confirm: "Passwords do not match",
      });
    });

    it("returns null when a path refine is satisfied", async () => {
      const schema = z
        .object({ password: z.string(), confirm: z.string() })
        .refine((v) => v.password === v.confirm, {
          message: "Passwords do not match",
          path: ["confirm"],
        });
      expect(await runForm(schema, { password: "a", confirm: "a" })).toBeNull();
    });

    it("routes issues to the matching discriminated-union variant", async () => {
      const schema = z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("a"), id: z.literal("", { error: "Should be empty" }) }),
        z.object({ kind: z.literal("b"), id: z.string().min(1, "id required") }),
      ]);
      expect(await runForm(schema, { kind: "a", id: "x" })).toEqual({
        id: "Should be empty",
      });
      expect(await runForm(schema, { kind: "b", id: "" })).toEqual({
        id: "id required",
      });
      expect(await runForm(schema, { kind: "b", id: "ok" })).toBeNull();
    });

    it("coerces a parseable input to null", async () => {
      expect(await runForm(z.object({ n: z.coerce.number() }), { n: "42" })).toBeNull();
    });

    it("reports a string error at the field for an uncoercible input", async () => {
      const errors = await runForm(z.object({ n: z.coerce.number() }), { n: "abc" });
      expect(errors).not.toBeNull();
      expect(typeof (errors as Record<string, unknown>).n).toBe("string");
    });

    it("does not error on a valid transform input", async () => {
      expect(
        await runForm(
          z.object({ up: z.string().transform((v) => v.toUpperCase()) }),
          { up: "abc" },
        ),
      ).toBeNull();
    });

    it("reports a string error for a missing required field", async () => {
      const errors = await runForm(z.object({ a: z.string() }), {});
      expect(errors).not.toBeNull();
      expect(typeof (errors as Record<string, unknown>).a).toBe("string");
    });

    it("awaits an async refinement", async () => {
      const schema = z
        .object({ u: z.string() })
        .refine(async (v) => v.u !== "taken", { message: "taken", path: ["u"] });
      expect(await runForm(schema, { u: "taken" })).toEqual({ u: "taken" });
      expect(await runForm(schema, { u: "free" })).toBeNull();
    });

    it("emits a _form key for a path-less superRefine issue", async () => {
      const schema = z.object({ a: z.string() }).superRefine((_v, ctx) => {
        ctx.addIssue({ code: "custom", message: "root only" });
      });
      expect(await runForm(schema, { a: "x" })).toEqual({ _form: "root only" });
    });
  });

  describe("with a schema factory", () => {
    it("resolves a (ctx) => schema factory per call", async () => {
      const factory = (_ctx: ValidationContext) =>
        z.object({ name: z.string().min(1, "required") });
      expect(await runForm(factory, { name: "" })).toEqual({ name: "required" });
      expect(await runForm(factory, { name: "x" })).toBeNull();
    });

    it("reads a store value through ctx.read", async () => {
      const appScope = scope();
      const limit = store(5);
      const factory = (ctx: ValidationContext) =>
        z.object({ name: z.string().max(ctx.read(limit), "too long") });
      // ctx.read reads a store, which needs an active scope.
      await scoped(appScope, async () => {
        // "abcdef".length === 6 > 5
        expect(await runForm(factory, { name: "abcdef" })).toEqual({ name: "too long" });
        expect(await runForm(factory, { name: "abcde" })).toBeNull();
      });
    });

    it("uses a non-function schema directly instead of calling it", async () => {
      const errors = await runForm(
        fakeSchema({ success: false, issues: [{ path: ["z"], message: "direct" }] }),
      );
      expect(errors).toEqual({ z: "direct" });
    });
  });

  describe("through createForm", () => {
    it("maps a nested and array error tree on validate", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          age: 0,
          tags: createArrayField<string>([]),
          profile: { email: "" },
        },
        validation: zodValidator(
          z.object({
            age: z.number().min(18, "Too young"),
            tags: z.array(z.string()).min(2, "At least two tags"),
            profile: z.object({ email: z.string().email("Invalid email") }),
          }),
        ),
      });

      await scoped(appScope, async () => {
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({
          age: "Too young",
          tags: "At least two tags",
          profile: { email: "Invalid email" },
        });
      });
    });

    it("clears a stale error on re-fill under the change strategy", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { a: "", b: "" },
        validation: zodValidator(
          z.object({ a: z.string().min(2, "min 2"), b: z.string().min(4, "min 4") }),
        ),
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await form.fill({ values: { a: "a", b: "a" } });
        expect(readStoreSnapshot(form.errors)).toEqual({ a: "min 2", b: "min 4" });

        await form.fill({ values: { a: "aa" } });
        expect(readStoreSnapshot(form.errors)).toEqual({ a: null, b: "min 4" });
      });
    });

    it("surfaces a per-index array error tree keyed by string index", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { tags: createArrayField<string>(["a", "b"]) },
        validation: zodValidator(
          z.object({ tags: z.array(z.string().min(3, "item min")) }),
        ),
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({
          tags: { "0": "item min", "1": "item min" },
        });
      });
    });

    it("surfaces a scalar error at the array key for z.array().min()", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { tags: createArrayField<string>([]) },
        validation: zodValidator(
          z.object({ tags: z.array(z.string()).min(2, "need two") }),
        ),
      });

      await scoped(appScope, async () => {
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({ tags: "need two" });
      });
    });

    it("surfaces a refine path error and clears it once fixed", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { password: "", confirm: "" },
        validation: zodValidator(
          z
            .object({ password: z.string(), confirm: z.string() })
            .refine((v) => v.password === v.confirm, {
              message: "Passwords do not match",
              path: ["confirm"],
            }),
        ),
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await form.fill({ values: { password: "secret", confirm: "nope" } });
        expect(readStoreSnapshot(form.errors)).toEqual({
          password: null,
          confirm: "Passwords do not match",
        });

        await form.fill({ values: { confirm: "secret" } });
        expect(readStoreSnapshot(form.errors)).toEqual({
          password: null,
          confirm: null,
        });
      });
    });

    it("routes discriminated-union errors end-to-end", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          name: "",
          contractType: "a" as "a" | "b",
          contractId: "",
        },
        validation: zodValidator(
          z.discriminatedUnion("contractType", [
            z.object({
              name: z.string().min(1, "Name required"),
              contractType: z.literal("a"),
              contractId: z.literal("", { error: "Should be empty" }),
            }),
            z.object({
              name: z.string().min(1, "Name required"),
              contractType: z.literal("b"),
              contractId: z.string().min(1, "Contract id required"),
            }),
          ]),
        ),
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await form.fill({
          values: { name: "Test", contractType: "a", contractId: "123" },
        });
        expect(readStoreSnapshot(form.errors)).toEqual({
          name: null,
          contractType: null,
          contractId: "Should be empty",
        });

        await form.fill({ values: { contractType: "b" } });
        expect(readStoreSnapshot(form.errors)).toEqual({
          name: null,
          contractType: null,
          contractId: null,
        });
      });
    });

    it("re-runs validation when a ctx.read store changes", async () => {
      const appScope = scope();
      const maxLength = store(3);
      const form = createForm({
        schema: { name: "Ada" },
        validation: zodValidator((ctx) =>
          z.object({ name: z.string().max(ctx.read(maxLength), "Too long") }),
        ),
      });

      await scoped(appScope, async () => {
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({ name: null });

        maxLength.value = 2;
        await scoped(() => tick(100));
        expect(readStoreSnapshot(form.errors)).toEqual({ name: "Too long" });
      });
    });

    it("settles an async refinement across ticks under the change strategy", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { username: "" },
        validation: zodValidator(
          z
            .object({ username: z.string() })
            .refine(async (v) => v.username !== "taken", {
              message: "username taken",
              path: ["username"],
            }),
        ),
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await form.fill({ values: { username: "taken" } });
        await scoped(() => tick(50));
        expect(readStoreSnapshot(form.errors)).toEqual({ username: "username taken" });

        await form.fill({ values: { username: "free" } });
        await scoped(() => tick(50));
        expect(readStoreSnapshot(form.errors)).toEqual({ username: null });
      });
    });

    // The adapter produces `{ _form: msg }` for a root issue, but createForm maps
    // errors onto fields by key; with no field named `_form`, the entry is silently
    // discarded. These two pin that behaviour green.
    it("drops a root-only refine failure, leaving the form valid", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { a: "" },
        validation: zodValidator(
          z.object({ a: z.string() }).superRefine((_v, ctx) => {
            ctx.addIssue({ code: "custom", message: "root only" });
          }),
        ),
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await form.fill({ values: { a: "x" } });
        // The _form message is dropped: no field error, and the form reads valid.
        expect(readStoreSnapshot(form.errors)).toEqual({ a: null });
        expect(readStoreSnapshot(form.isValid)).toBe(true);
      });
    });

    it("keeps only the path error when a path and a root issue coexist", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { a: "" },
        validation: zodValidator(
          z.object({ a: z.string() }).superRefine((_v, ctx) => {
            ctx.addIssue({ code: "custom", message: "path err", path: ["a"] });
            ctx.addIssue({ code: "custom", message: "root err" });
          }),
        ),
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await form.fill({ values: { a: "x" } });
        expect(readStoreSnapshot(form.errors)).toEqual({ a: "path err" });
        expect(readStoreSnapshot(form.isValid)).toBe(false);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// zodFieldValidator
// ---------------------------------------------------------------------------

describe("zodFieldValidator", () => {
  it("returns null when the value is accepted", async () => {
    expect(await runField(z.string().min(2, "min 2"), "ok")).toBeNull();
    expect(await runField(fakeSchema({ success: true }), 123)).toBeNull();
  });

  it("returns the failing issue's message", async () => {
    expect(await runField(z.string().min(2, "min 2"), "x")).toBe("min 2");
  });

  it("returns the first issue's message, ignoring later issues", async () => {
    const message = await runField(
      fakeSchema({
        success: false,
        issues: [
          { path: ["ignored"], message: "first" },
          { path: ["other"], message: "second" },
        ],
      }),
      "anything",
    );
    expect(message).toBe("first");
  });

  it("falls back to 'Invalid value' for an empty issues array", async () => {
    expect(await runField(fakeSchema({ success: false, issues: [] }), "x")).toBe(
      "Invalid value",
    );
  });

  it("falls back to 'Invalid value' when the first issue has no message", async () => {
    expect(
      await runField(
        fakeSchema({ success: false, issues: [{ path: [], message: undefined }] }),
        "x",
      ),
    ).toBe("Invalid value");
  });

  it("returns an empty-string message verbatim", async () => {
    // The fallback uses `?? "Invalid value"`, not `|| ...`, so a falsy-but-
    // defined "" is passed through unchanged rather than replaced.
    expect(
      await runField(
        fakeSchema({ success: false, issues: [{ path: [], message: "" }] }),
        "x",
      ),
    ).toBe("");
  });

  it("reads a store through a factory schema's ctx.read", async () => {
    const appScope = scope();
    const limit = store(4);
    const validate = (ctx: ValidationContext) =>
      z.string().max(ctx.read(limit), "too long");
    await scoped(appScope, async () => {
      expect(await runField(validate, "abcde")).toBe("too long");
      expect(await runField(validate, "abcd")).toBeNull();
    });
  });

  it("surfaces its error through createField", async () => {
    const appScope = scope();
    const field = createField("", {
      validate: zodFieldValidator(z.string().min(2, "min 2")),
    });

    await scoped(appScope, async () => {
      await field.validate();
      expect(field.error.value).toBe("min 2");

      await field.fill("ok");
      await field.validate();
      expect(field.error.value).toBeNull();
    });
  });
});
