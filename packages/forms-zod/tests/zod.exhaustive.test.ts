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
// alias
// ---------------------------------------------------------------------------

describe("@virentia/forms-zod / aliases", () => {
  it("zodFormValidator is the exact same reference as zodValidator", () => {
    expect(zodFormValidator).toBe(zodValidator);
  });
});

// ---------------------------------------------------------------------------
// zodValidator: success path
// ---------------------------------------------------------------------------

describe("@virentia/forms-zod / zodValidator success", () => {
  it("returns null when a plain schema parses", async () => {
    expect(await runForm(z.object({ a: z.string() }), { a: "ok" })).toBeNull();
  });

  it("returns null for an empty object schema (and ignores extra keys)", async () => {
    expect(await runForm(z.object({}), {})).toBeNull();
    expect(await runForm(z.object({}), { unexpected: 1 })).toBeNull();
  });

  it("returns null for optional / nullable / default fields when absent", async () => {
    expect(await runForm(z.object({ a: z.string().optional() }), {})).toBeNull();
    expect(
      await runForm(z.object({ a: z.string().nullable() }), { a: null }),
    ).toBeNull();
    expect(await runForm(z.object({ a: z.string().default("x") }), {})).toBeNull();
  });

  it("returns null through a fake schema reporting success", async () => {
    expect(await runForm(fakeSchema({ success: true }))).toBeNull();
  });

  it("a FAILED parse with an empty issues array yields {} (NOT null)", async () => {
    // success:false short-circuits the `if (result.success) return null` guard,
    // so zodIssuesToErrors runs over an empty list and returns an empty object.
    // The form layer then treats {} as no-errors, but the adapter itself does
    // not collapse it back to null. Pin the exact object.
    expect(await runForm(fakeSchema({ success: false, issues: [] }))).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// zodIssuesToErrors + setPathError: branch-by-branch (via fake schema)
// ---------------------------------------------------------------------------

describe("@virentia/forms-zod / setPathError branches", () => {
  it("empty path writes the _form key at the root", async () => {
    const errors = await runForm(
      fakeSchema({ success: false, issues: [{ path: [], message: "root problem" }] }),
    );
    expect(errors).toEqual({ _form: "root problem" });
  });

  it("a single scalar leaf becomes a top-level key", async () => {
    const errors = await runForm(
      fakeSchema({ success: false, issues: [{ path: ["email"], message: "bad" }] }),
    );
    expect(errors).toEqual({ email: "bad" });
  });

  it("a nested object path builds the intermediate objects", async () => {
    const errors = await runForm(
      fakeSchema({
        success: false,
        issues: [{ path: ["profile", "email"], message: "bad email" }],
      }),
    );
    expect(errors).toEqual({ profile: { email: "bad email" } });
  });

  it("numeric array-index segments become string keys", async () => {
    const errors = await runForm(
      fakeSchema({ success: false, issues: [{ path: ["tags", 0], message: "idx0" }] }),
    );
    expect(errors).toEqual({ tags: { "0": "idx0" } });
  });

  it("a leading numeric segment becomes a string key at the root", async () => {
    const errors = await runForm(
      fakeSchema({ success: false, issues: [{ path: [0], message: "first" }] }),
    );
    expect(errors).toEqual({ "0": "first" });
  });

  it("purely numeric nested segments become nested string keys", async () => {
    const errors = await runForm(
      fakeSchema({ success: false, issues: [{ path: [1, 2], message: "deep" }] }),
    );
    expect(errors).toEqual({ "1": { "2": "deep" } });
  });

  it("root (_form) is LAST-wins, unlike leaf paths (asymmetry pin)", async () => {
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

  it("first issue wins for the same leaf path; the later one is dropped", async () => {
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

  it("first-wins also drops a later scalar when the key already holds an object", async () => {
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

  it("traversing THROUGH a segment holding a scalar overwrites it to {} and descends", async () => {
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

  it("WILD: a 5-level-deep path builds a fully nested tree", async () => {
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

  it("WILD: unicode path segments are preserved verbatim as keys", async () => {
    const errors = await runForm(
      fakeSchema({
        success: false,
        issues: [{ path: ["café", "日本語", "🚀"], message: "u" }],
      }),
    );
    expect(errors).toEqual({ café: { "日本語": { "🚀": "u" } } });
  });

  it("WILD: a dotted-looking segment stays a single literal key (no splitting here)", async () => {
    // setPathError does NOT split on '.', it uses the raw String(segment). Any
    // dotted-path expansion happens later, in the form layer, not the adapter.
    const errors = await runForm(
      fakeSchema({ success: false, issues: [{ path: ["a.b.c"], message: "dotted" }] }),
    );
    expect(errors).toEqual({ "a.b.c": "dotted" });
    expect(Object.keys(errors ?? {})).toEqual(["a.b.c"]);
  });

  it("WILD: a symbol segment is coerced via String()", async () => {
    const sym = Symbol("weird");
    const errors = await runForm(
      fakeSchema({ success: false, issues: [{ path: [sym], message: "s" }] }),
    );
    expect(errors).toEqual({ [String(sym)]: "s" });
  });
});

// ---------------------------------------------------------------------------
// zodValidator with real zod schemas
// ---------------------------------------------------------------------------

describe("@virentia/forms-zod / zodValidator with real schemas", () => {
  it("keeps the FIRST of multiple zod issues on one field", async () => {
    const errors = await runForm(
      z.object({ email: z.string().min(2, "len").email("email") }),
      { email: "1" },
    );
    expect(errors).toEqual({ email: "len" });
  });

  it("maps nested and array (.min) issues into a scalar-at-key tree", async () => {
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

  it("superRefine: same path first-wins, distinct paths, and root all combine", async () => {
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

  it("refine with a path produces a targeted error and null when satisfied", async () => {
    const schema = z
      .object({ password: z.string(), confirm: z.string() })
      .refine((v) => v.password === v.confirm, {
        message: "Passwords do not match",
        path: ["confirm"],
      });
    expect(await runForm(schema, { password: "a", confirm: "b" })).toEqual({
      confirm: "Passwords do not match",
    });
    expect(await runForm(schema, { password: "a", confirm: "a" })).toBeNull();
  });

  it("discriminatedUnion routes issues to the matching variant", async () => {
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

  it(".coerce parses successfully or reports a failure at the field", async () => {
    expect(await runForm(z.object({ n: z.coerce.number() }), { n: "42" })).toBeNull();
    const errors = await runForm(z.object({ n: z.coerce.number() }), { n: "abc" });
    expect(errors).not.toBeNull();
    expect(typeof (errors as Record<string, unknown>).n).toBe("string");
  });

  it(".transform on a valid input does not produce an error", async () => {
    expect(
      await runForm(
        z.object({ up: z.string().transform((v) => v.toUpperCase()) }),
        { up: "abc" },
      ),
    ).toBeNull();
  });

  it("reports required/missing fields", async () => {
    const errors = await runForm(z.object({ a: z.string() }), {});
    expect(errors).not.toBeNull();
    expect(typeof (errors as Record<string, unknown>).a).toBe("string");
  });

  it("supports async refinement (awaits across ticks)", async () => {
    const schema = z
      .object({ u: z.string() })
      .refine(async (v) => v.u !== "taken", { message: "taken", path: ["u"] });
    expect(await runForm(schema, { u: "taken" })).toEqual({ u: "taken" });
    expect(await runForm(schema, { u: "free" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Schema factory forms
// ---------------------------------------------------------------------------

describe("@virentia/forms-zod / schema factory", () => {
  it("accepts a factory (ctx) => schema and resolves it per call", async () => {
    const factory = (_ctx: ValidationContext) =>
      z.object({ name: z.string().min(1, "required") });
    expect(await runForm(factory, { name: "" })).toEqual({ name: "required" });
    expect(await runForm(factory, { name: "x" })).toBeNull();
  });

  it("a factory can read a store value through ctx.read", async () => {
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

  it("a bare (non-function) fake schema is used directly, not called as a factory", async () => {
    const errors = await runForm(
      fakeSchema({ success: false, issues: [{ path: ["z"], message: "direct" }] }),
    );
    expect(errors).toEqual({ z: "direct" });
  });
});

// ---------------------------------------------------------------------------
// zodFieldValidator
// ---------------------------------------------------------------------------

describe("@virentia/forms-zod / zodFieldValidator", () => {
  it("returns null on success", async () => {
    expect(await runField(z.string().min(2, "min 2"), "ok")).toBeNull();
    expect(await runField(fakeSchema({ success: true }), 123)).toBeNull();
  });

  it("returns the first issue message on failure", async () => {
    expect(await runField(z.string().min(2, "min 2"), "x")).toBe("min 2");
  });

  it("returns issues[0].message and ignores later issues / their paths", async () => {
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

  it("falls back to 'Invalid value' when the issues array is empty", async () => {
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

  it("returns an EMPTY-STRING message verbatim (?? guards null/undefined only)", async () => {
    // The fallback uses `?? "Invalid value"`, not `|| ...`, so a falsy-but-
    // defined "" is passed through unchanged rather than replaced.
    expect(
      await runField(
        fakeSchema({ success: false, issues: [{ path: [], message: "" }] }),
        "x",
      ),
    ).toBe("");
  });

  it("resolves a factory schema and can read a store through ctx.read", async () => {
    const appScope = scope();
    const limit = store(4);
    const validate = (ctx: ValidationContext) =>
      z.string().max(ctx.read(limit), "too long");
    await scoped(appScope, async () => {
      expect(await runField(validate, "abcde")).toBe("too long");
      expect(await runField(validate, "abcd")).toBeNull();
    });
  });

  it("integrates with createField", async () => {
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

// ---------------------------------------------------------------------------
// Integration through createForm
// ---------------------------------------------------------------------------

describe("@virentia/forms-zod / createForm integration", () => {
  it("maps a full nested/array error tree on validate()", async () => {
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

  it("clears stale errors on re-fill under the 'change' strategy", async () => {
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

  it("surfaces a path error from a refine and clears it when fixed", async () => {
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

  it("supports discriminated unions end-to-end", async () => {
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

  it("re-runs validation reactively when a ctx.read store changes", async () => {
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

  it("settles an async refinement across ticks under the 'change' strategy", async () => {
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

  // -------------------------------------------------------------------------
  // BUG PINS: root-level "_form" errors do not survive createForm's error tree.
  // The adapter correctly produces `{ _form: msg }`, but the form layer maps
  // errors onto fields by key; with no field named `_form`, the entry is
  // silently discarded. Pinned green so the suite stays honest.
  // -------------------------------------------------------------------------
  it("BUG(zod-form-root-dropped): the validator itself DOES emit a _form key", async () => {
    const schema = z.object({ a: z.string() }).superRefine((_v, ctx) => {
      ctx.addIssue({ code: "custom", message: "root only" });
    });
    expect(await runForm(schema, { a: "x" })).toEqual({ _form: "root only" });
  });

  it("BUG(zod-form-root-dropped): a root-only refine failure leaves the form VALID", async () => {
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

  it("BUG(zod-form-root-dropped): with both a path and a root issue, only the path survives", async () => {
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
