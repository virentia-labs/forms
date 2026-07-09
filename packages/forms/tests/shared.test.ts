import { describe, expect, it } from "vitest";
import {
  computed,
  getCurrentScope,
  scope,
  scoped,
  store,
  type Store,
} from "@virentia/core";
import {
  createArrayField,
  createField,
  createForm,
  createShapeField,
  defineField,
  normalizeField,
  readStoreSnapshot,
  type AnyField,
  type FieldContract,
} from "../lib";
import { deferred, tick, watchCalls } from "./_helpers";

// Cast a hand-built plain object to the store type readStoreSnapshot expects, so
// we can exercise its branching (single-value / array / object / edge) directly
// without a real kernel store (real @virentia/core stores always expose exactly
// one non-native key, `value`, and so only ever hit the single-value branch).
const asStore = <T>(shape: unknown): Store<T> => shape as Store<T>;

describe("readStoreSnapshot", () => {
  it("returns the raw value for a single-key `value` store", () => {
    expect(readStoreSnapshot(asStore<number>({ value: 5 }))).toBe(5);
    expect(readStoreSnapshot(asStore<null>({ value: null }))).toBe(null);
    expect(readStoreSnapshot(asStore<string>({ value: "" }))).toBe("");
    const obj = { a: 1 };
    expect(readStoreSnapshot(asStore<object>({ value: obj }))).toBe(obj);
  });

  it("excludes native store keys when detecting a single-value store", () => {
    const snapshot = readStoreSnapshot(
      asStore<number>({
        node: {},
        writable: {},
        subscribe() {},
        map() {},
        filter() {},
        filterMap() {},
        value: 42,
      }),
    );
    expect(snapshot).toBe(42);
  });

  it("materializes an array store from numeric keys and a numeric length", () => {
    expect(
      readStoreSnapshot(asStore<string[]>({ "0": "a", "1": "b", length: 2 })),
    ).toEqual(["a", "b"]);
    expect(readStoreSnapshot(asStore<never[]>({ length: 0 }))).toEqual([]);
  });

  it("uses `length` to size the array even past defined numeric keys", () => {
    // length wins over the actual key set: missing indexes read as undefined.
    expect(
      readStoreSnapshot(asStore<unknown[]>({ "0": "a", length: 3 })),
    ).toEqual(["a", undefined, undefined]);
  });

  it("treats numeric-key stores without a length as an object", () => {
    expect(
      readStoreSnapshot(asStore<Record<string, string>>({ "0": "a", "1": "b" })),
    ).toEqual({ "0": "a", "1": "b" });
  });

  it("treats a non-numeric `length` as an object, not an array", () => {
    expect(
      readStoreSnapshot(asStore<Record<string, unknown>>({ "0": "a", length: "2" })),
    ).toEqual({ "0": "a", length: "2" });
  });

  it("treats numeric keys mixed with a non-numeric key as an object", () => {
    expect(
      readStoreSnapshot(
        asStore<Record<string, unknown>>({ "0": "a", x: 1, length: 1 }),
      ),
    ).toEqual({ "0": "a", x: 1, length: 1 });
  });

  it("materializes a sparse array store, filling gaps with undefined", () => {
    // Keys "0" and "2" present, "1" missing, length 3 -> hole reads as undefined.
    expect(
      readStoreSnapshot(asStore<unknown[]>({ "0": "a", "2": "c", length: 3 })),
    ).toEqual(["a", undefined, "c"]);
  });

  it("treats a leading-zero numeric key as an object, not an array", () => {
    // "01" is not a canonical array index (regex /^(0|[1-9]\d*)$/) -> object branch.
    expect(
      readStoreSnapshot(asStore<Record<string, unknown>>({ "01": "a", length: 1 })),
    ).toEqual({ "01": "a", length: 1 });
  });

  it("treats a negative numeric-looking key as an object, not an array", () => {
    expect(
      readStoreSnapshot(asStore<Record<string, unknown>>({ "-1": "a", length: 1 })),
    ).toEqual({ "-1": "a", length: 1 });
  });

  it("returns entries for a plain object store", () => {
    expect(
      readStoreSnapshot(asStore<Record<string, number>>({ a: 1, b: 2 })),
    ).toEqual({ a: 1, b: 2 });
  });

  it("does not treat `value` as special when it is not the sole key", () => {
    expect(
      readStoreSnapshot(asStore<Record<string, number>>({ value: 5, other: 6 })),
    ).toEqual({ value: 5, other: 6 });
  });

  it("does not treat a single non-`value` key as a scalar", () => {
    expect(
      readStoreSnapshot(asStore<Record<string, number>>({ foo: 9 })),
    ).toEqual({ foo: 9 });
  });

  it("returns an empty object when only native keys are present", () => {
    expect(
      readStoreSnapshot(asStore<Record<string, unknown>>({ node: {}, subscribe() {} })),
    ).toEqual({});
  });

  it("reads real field / array / shape / form stores", async () => {
    const appScope = scope();
    const field = createField("hello");
    const tags = createArrayField(["a", "b"]);
    const shape = createShapeField({ a: createField(1), b: createField(2) });
    const form = createForm({ schema: { name: "x", nested: { k: 0 } } });

    await scoped(appScope, async () => {
      // Field/array/form value stores are single-key `value` stores under the hood.
      expect(readStoreSnapshot(field.state)).toBe("hello");
      expect(readStoreSnapshot(field.error)).toBe(null);
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "b"]);
      expect(readStoreSnapshot(tags.length)).toBe(2);
      expect(Object.keys(readStoreSnapshot(tags.itemFields))).toEqual(["0", "1"]);
      expect(readStoreSnapshot(shape.state)).toEqual({ a: 1, b: 2 });
      expect(readStoreSnapshot(form.values)).toEqual({ name: "x", nested: { k: 0 } });
    });
  });
});

describe("normalizeField", () => {
  it("caches one stable wrapper per field instance", () => {
    const field = createField("x");
    const other = createField("y");

    expect(normalizeField(field)).toBe(normalizeField(field));
    expect(normalizeField(field)).not.toBe(normalizeField(other));
  });

  it("returns identical synthesized units across repeated normalizations", () => {
    const value = store<Record<string, AnyField>>({});
    const custom = defineField({
      kind: "synth",
      state: computed(() => 0),
      readFields: () => ({}),
      async fill() {},
      async reset() {},
    } as unknown as FieldContract<number, unknown, number>);

    const first = normalizeField(custom);
    const second = normalizeField(custom);
    expect(first.validate).toBe(second.validate);
    expect(first.fill).toBe(second.fill);
    expect(first.errors).toBe(second.errors);
    expect(first.isValid).toBe(second.isValid);
    void value;
  });

  it("reads via field.read, then serialize().value, then the state store", async () => {
    const appScope = scope();
    const stateStore = store("fromstate");
    const withRead = {
      kind: "a",
      state: stateStore,
      read: () => "fromread",
      serialize: () => ({ value: "fromser", errors: null }),
      async fill() {},
      async reset() {},
    } as unknown as FieldContract<string>;
    const withSerialize = {
      kind: "b",
      state: stateStore,
      serialize: () => ({ value: "fromser", errors: null }),
      async fill() {},
      async reset() {},
    } as unknown as FieldContract<string>;
    const withStateOnly = {
      kind: "c",
      state: stateStore,
      async fill() {},
      async reset() {},
    } as unknown as FieldContract<string>;

    await scoped(appScope, async () => {
      expect(normalizeField(withRead).read()).toBe("fromread");
      expect(normalizeField(withSerialize).read()).toBe("fromser");
      // No read/serialize: falls back to readStoreSnapshot(state).
      expect(normalizeField(withStateOnly).read()).toBe("fromstate");
    });
  });

  it("synthesizes a merged errors view from children, with outer overriding inner", async () => {
    const appScope = scope();
    const a = createField("x");
    const b = createField("y");
    const group = defineField({
      kind: "group",
      state: computed(() => ({ a: a.state.value, b: b.state.value })),
      fields: { a, b },
      async fill() {},
      async reset() {},
    } as unknown as FieldContract<
      { a: string; b: string },
      { a: string | null; b: string | null },
      { a: string; b: string }
    >);
    const normalized = normalizeField(group);

    await scoped(appScope, async () => {
      // errors/innerErrors/outerErrors are synthesized from the children.
      expect(readStoreSnapshot(normalized.errors)).toEqual({ a: null, b: null });

      await normalized.setOuterErrors({ a: "A outer", b: null });
      expect(readStoreSnapshot(normalized.outerErrors)).toEqual({ a: "A outer", b: null });
      expect(readStoreSnapshot(normalized.errors)).toEqual({ a: "A outer", b: null });

      await normalized.setInnerErrors({ a: null, b: "B inner" });
      expect(readStoreSnapshot(normalized.innerErrors)).toEqual({ a: null, b: "B inner" });
      // outer wins over inner on `a`; `b` has only inner.
      expect(readStoreSnapshot(normalized.errors)).toEqual({ a: "A outer", b: "B inner" });

      await normalized.clearOuterErrors();
      expect(readStoreSnapshot(normalized.errors)).toEqual({ a: null, b: "B inner" });

      await normalized.clearInnerErrors();
      expect(readStoreSnapshot(normalized.errors)).toEqual({ a: null, b: null });
    });
  });

  it("synthesizes a validate that traverses children when the field omits one", async () => {
    const appScope = scope();
    const child = createField("", {
      validate: (value: string) => (value ? null : "req"),
    });
    const group = defineField({
      kind: "group",
      state: computed(() => ({ child: child.state.value })),
      fields: { child },
      async fill() {},
      async reset() {},
    } as unknown as FieldContract<unknown, unknown, unknown>);
    const normalized = normalizeField(group);

    await scoped(appScope, async () => {
      await normalized.validate();
      expect(child.error.value).toBe("req");
    });
  });

  it("reflects children that arrive after normalization", async () => {
    const appScope = scope();
    let children: Record<string, AnyField> = {};
    const custom = {
      kind: "dyn",
      state: computed(() => 0),
      readFields: () => children,
      async fill() {},
      async reset() {},
    } as unknown as FieldContract<number, unknown, number>;
    // Normalized while there are NO children -> the errors view must NOT freeze
    // to a permanent null; it re-evaluates hasChildren() on every read.
    const normalized = normalizeField(custom);

    const child = createField("");
    await scoped(appScope, async () => {
      await child.setOuterError("boom");
    });
    children = { child };

    await scoped(appScope, async () => {
      // Now that a child reports an error, the dynamic errors view surfaces it
      // instead of being stuck on the normalize-time empty snapshot.
      expect(readStoreSnapshot(normalized.errors)).toEqual({ child: "boom" });
      expect(normalized.isValid.value).toBe(false);
    });
  });
});

describe("expandDottedPaths", () => {
  it("expands a single dotted path into a nested tree", async () => {
    const appScope = scope();
    const form = createForm({ schema: { a: { b: createField("") } } });

    await scoped(appScope, async () => {
      await form.fill({ errors: { "a.b": "deep" } as never });
      expect(readStoreSnapshot(form.errors)).toEqual({ a: { b: "deep" } });
    });
  });

  it("expands a deeply dotted path", async () => {
    const appScope = scope();
    const form = createForm({ schema: { a: { b: { c: createField("") } } } });

    await scoped(appScope, async () => {
      await form.fill({ errors: { "a.b.c": "deepest" } as never });
      expect(readStoreSnapshot(form.errors)).toEqual({ a: { b: { c: "deepest" } } });
    });
  });

  it("merges sibling object paths with the later scalar winning", async () => {
    const appScope = scope();
    const form = createForm({
      schema: { a: { b: createField(""), c: createField("") } },
    });

    await scoped(appScope, async () => {
      // { a: { b } } then { a: { c } } deep-merge into one group; both survive.
      await form.fill({
        errors: { a: { b: "B" }, "a.c": "C" } as never,
      });
      expect(readStoreSnapshot(form.errors)).toEqual({ a: { b: "B", c: "C" } });
    });
  });

  it("with a dotted path before a nested object, the later nested object wins", async () => {
    const appScope = scope();
    const formA = createForm({ schema: { a: { b: createField("") } } });

    await scoped(appScope, async () => {
      // Order A: dotted first, then nested object -> mergePlainObjects, second wins.
      await formA.fill({ errors: { "a.b": "x", a: { b: "y" } } as never });
      expect(readStoreSnapshot(formA.errors)).toEqual({ a: { b: "y" } });
    });
  });

  it("with a nested object before a dotted path, the later dotted path wins", async () => {
    const appScope = scope();
    const formB = createForm({ schema: { a: { b: createField("") } } });

    await scoped(appScope, async () => {
      // Order B: nested object first, then dotted -> setNestedPath overwrites, dotted wins.
      await formB.fill({ errors: { a: { b: "y" }, "a.b": "x" } as never });
      expect(readStoreSnapshot(formB.errors)).toEqual({ a: { b: "x" } });
    });
  });
});

describe("deepEqual", () => {
  it("treats a NaN re-filled with NaN as unchanged", async () => {
    const appScope = scope();
    const form = createForm({ schema: { n: NaN, s: "keep" } });

    await scoped(appScope, async () => {
      expect(form.isChanged.value).toBe(false);
      await form.fill({ values: { n: NaN } as never });
      // Object.is(NaN, NaN) === true -> deepEqual true -> still unchanged.
      expect(form.isChanged.value).toBe(false);
    });
  });

  it("reports a change when the value type differs", async () => {
    const appScope = scope();
    const form = createForm({ schema: { s: "0" } });

    await scoped(appScope, async () => {
      await form.fill({ values: { s: 0 as never } });
      expect(form.isChanged.value).toBe(true);
    });
  });

  it("reports a change when an array differs in length or in an element", async () => {
    const appScope = scope();
    const form = createForm({ schema: { tags: createArrayField(["a", "b"]) } });

    await scoped(appScope, async () => {
      await form.fill({ values: { tags: ["a", "b"] } });
      expect(form.isChanged.value).toBe(false);

      await form.fill({ values: { tags: ["a", "b", "c"] } });
      expect(form.isChanged.value).toBe(true);

      await form.forceUpdateSnapshot();
      await form.fill({ values: { tags: ["a", "b", "z"] } });
      expect(form.isChanged.value).toBe(true);
    });
  });

  it("treats equal empty arrays as unchanged", async () => {
    const appScope = scope();
    const form = createForm({ schema: { tags: createArrayField<string>([]) } });

    await scoped(appScope, async () => {
      expect(form.isChanged.value).toBe(false);
      await form.fill({ values: { tags: [] } });
      // deepEqual([], []) -> both length 0, every() vacuously true -> equal.
      expect(form.isChanged.value).toBe(false);
    });
  });

  it("compares nested arrays element-wise", async () => {
    const appScope = scope();
    const form = createForm({ schema: { matrix: [[1], [2]] } });

    await scoped(appScope, async () => {
      await form.fill({ values: { matrix: [[1], [2]] } });
      expect(form.isChanged.value).toBe(false);

      await form.fill({ values: { matrix: [[1], [3]] } });
      // Inner deepEqual([2],[3]) -> false -> changed.
      expect(form.isChanged.value).toBe(true);
    });
  });

  it("reports a change when a nested object differs in key count or value", async () => {
    const appScope = scope();
    const form = createForm({ schema: { profile: { a: 1, b: 2 } } });

    await scoped(appScope, async () => {
      await form.fill({ values: { profile: { a: 1, b: 2 } } });
      expect(form.isChanged.value).toBe(false);

      await form.fill({ values: { profile: { b: 99 } } });
      expect(form.isChanged.value).toBe(true);
    });
  });

  it("compares Dates by instant, so changing a Date field reports a change", async () => {
    const appScope = scope();
    const form = createForm({ schema: { d: new Date(2000, 0, 1) } });

    await scoped(appScope, async () => {
      expect(form.isChanged.value).toBe(false);

      await form.fill({ values: { d: new Date(2020, 5, 15) } as never });
      // The value store changed...
      expect((readStoreSnapshot(form.values) as { d: Date }).d.getFullYear()).toBe(2020);
      // ...and deepEqual now special-cases Dates (getTime()), so isChanged is true.
      expect(form.isChanged.value).toBe(true);

      // A Date re-filled with the same instant is still "unchanged".
      await form.forceUpdateSnapshot();
      await form.fill({ values: { d: new Date(2020, 5, 15) } as never });
      expect(form.isChanged.value).toBe(false);
    });
  });
});

describe("cloneSnapshot", () => {
  it("clones Dates into distinct-but-equal instances", async () => {
    const appScope = scope();
    const form = createForm({ schema: { d: new Date(2000, 0, 1) } });

    await scoped(appScope, async () => {
      const snapshotDate = (readStoreSnapshot(form.snapshot) as { d: Date }).d;
      const valueDate = (readStoreSnapshot(form.values) as { d: Date }).d;

      // Snapshot Date is a fresh clone (new Date(getTime())): a different object...
      expect(snapshotDate).not.toBe(valueDate);
      // ...but equal in time, so deepEqual (which now compares Dates by getTime())
      // correctly treats the untouched Date as unchanged.
      expect(snapshotDate.getTime()).toBe(valueDate.getTime());
      expect(form.isChanged.value).toBe(false);
    });
  });

  it("keeps class instances as a shared reference", async () => {
    const appScope = scope();
    class Point {
      constructor(public x: number) {}
    }
    const point = new Point(1);
    // A non-plain, non-Date, non-array object is returned as-is by cloneSnapshot.
    const form = createForm({ schema: { p: createField(point) } });

    await scoped(appScope, async () => {
      const snapshotPoint = (readStoreSnapshot(form.snapshot) as { p: Point }).p;
      const valuePoint = (readStoreSnapshot(form.values) as { p: Point }).p;
      // Same identity in both the snapshot and the live value (shared ref).
      expect(snapshotPoint).toBe(point);
      expect(valuePoint).toBe(point);
      // Object.is(point, point) === true -> deepEqual -> unchanged.
      expect(form.isChanged.value).toBe(false);
    });
  });

  it("clones nested objects recursively so the snapshot is a distinct tree", async () => {
    const appScope = scope();
    const form = createForm({ schema: { profile: { a: 1, b: 2 } } });

    await scoped(appScope, async () => {
      const snapshot = readStoreSnapshot(form.snapshot) as { profile: object };
      const values = readStoreSnapshot(form.values) as { profile: object };
      expect(snapshot.profile).not.toBe(values.profile);
      expect(snapshot).toEqual(values);
    });
  });

  it("restores a deep-equal baseline through reset", async () => {
    const appScope = scope();
    const form = createForm({
      schema: { tags: createArrayField(["a"]), profile: { city: "" } },
    });

    await scoped(appScope, async () => {
      await form.fill({ values: { tags: ["a", "b"], profile: { city: "Kyiv" } } });
      expect(form.isChanged.value).toBe(true);

      await form.reset();
      expect(readStoreSnapshot(form.values)).toEqual({ tags: ["a"], profile: { city: "" } });
      expect(readStoreSnapshot(form.snapshot)).toEqual({ tags: ["a"], profile: { city: "" } });
      expect(form.isChanged.value).toBe(false);
    });
  });
});

describe("hasErrors", () => {
  it("counts only null and undefined as no error, flagging every present scalar", async () => {
    const appScope = scope();
    const errorsBox = store<unknown>(null);
    const custom = {
      kind: "custom",
      state: computed(() => "v"),
      errors: errorsBox,
      async fill() {},
      async reset() {},
    } as unknown as FieldContract<string, unknown, string>;
    const normalized = normalizeField(custom);

    await scoped(appScope, async () => {
      const validFor = (value: unknown) => {
        errorsBox.value = value;
        return normalized.isValid.value;
      };

      expect(validFor(null)).toBe(true);
      expect(validFor(undefined)).toBe(true);
      // Falsy-but-present scalars still count as errors.
      expect(validFor("")).toBe(false);
      expect(validFor(0)).toBe(false);
      expect(validFor(false)).toBe(false);
      expect(validFor("nope")).toBe(false);
    });
  });

  it("flags an errored leaf anywhere in a nested array or object tree", async () => {
    const appScope = scope();
    const errorsBox = store<unknown>(null);
    const custom = {
      kind: "custom",
      state: computed(() => "v"),
      errors: errorsBox,
      async fill() {},
      async reset() {},
    } as unknown as FieldContract<string, unknown, string>;
    const normalized = normalizeField(custom);

    await scoped(appScope, async () => {
      const validFor = (value: unknown) => {
        errorsBox.value = value;
        return normalized.isValid.value;
      };

      expect(validFor([null, null])).toBe(true);
      expect(validFor({ a: null, b: { c: null } })).toBe(true);
      expect(validFor([null, { a: null }])).toBe(true);
      // Deeply-nested arrays-of-objects error trees.
      expect(validFor([null, { a: "err" }])).toBe(false);
      expect(validFor({ a: [{ b: 0 }] })).toBe(false);
      expect(validFor([[{ x: false }]])).toBe(false);
    });
  });

  it("treats an empty array or object as having no errors", async () => {
    const appScope = scope();
    const errorsBox = store<unknown>(null);
    const custom = {
      kind: "custom",
      state: computed(() => "v"),
      errors: errorsBox,
      async fill() {},
      async reset() {},
    } as unknown as FieldContract<string, unknown, string>;
    const normalized = normalizeField(custom);

    await scoped(appScope, async () => {
      const validFor = (value: unknown) => {
        errorsBox.value = value;
        return normalized.isValid.value;
      };

      // `.some` over an empty container is vacuously false -> no error.
      expect(validFor([])).toBe(true);
      expect(validFor({})).toBe(true);
      expect(validFor([[], {}])).toBe(true);
    });
  });

  it("drives form.isValid through nested array-of-object error trees", async () => {
    const appScope = scope();
    const form = createForm({
      schema: {
        people: createArrayField([{ name: "" }], {
          createItem(value: { name: string }) {
            return createField(value.name);
          },
        }),
      },
    });

    await scoped(appScope, async () => {
      expect(form.isValid.value).toBe(true);

      await form.fill({ errors: { people: [{ name: "" }] } as never });
      // "" is a present scalar leaf deep in the tree -> hasErrors true -> invalid.
      expect(form.isValid.value).toBe(false);
    });
  });
});

describe("pickSchema", () => {
  it("projects selected leaves and nested selections, dropping unknown keys", async () => {
    const appScope = scope();
    const form = createForm({
      schema: {
        a: createField("a"),
        b: createField("b"),
        group: { x: createField("x"), y: createField("y") },
      },
    });

    await scoped(appScope, async () => {
      const projection = form.pick({ a: true, group: { x: true }, nope: true } as never);
      expect(readStoreSnapshot(projection.values)).toEqual({ a: "a", group: { x: "x" } });
    });
  });

  it("selects an entire group when the selection value is `true`", async () => {
    const appScope = scope();
    const form = createForm({
      schema: { group: { x: createField("x"), y: createField("y") } },
    });

    await scoped(appScope, async () => {
      const whole = form.pick({ group: true } as never);
      expect(readStoreSnapshot(whole.values)).toEqual({ group: { x: "x", y: "y" } });
    });
  });

  it("produces an empty projection for an empty selection", async () => {
    const appScope = scope();
    const form = createForm({ schema: { a: createField("a"), b: createField("b") } });

    await scoped(appScope, async () => {
      const projection = form.pick({} as never);
      expect(readStoreSnapshot(projection.values)).toEqual({});
    });
  });

  it("treats a leaf field as whole even if the selection tries to recurse", async () => {
    const appScope = scope();
    const form = createForm({ schema: { name: createField("Ada") } });

    await scoped(appScope, async () => {
      // schema.name is a field contract -> selected whole, the nested selection ignored.
      const projection = form.pick({ name: { deep: true } } as never);
      expect(readStoreSnapshot(projection.values)).toEqual({ name: "Ada" });
    });
  });
});

describe("scope invariants", () => {
  it("createValidationContext.read reads a tracked store under each scope's own value", async () => {
    const scopeA = scope();
    const scopeB = scope();
    const minAge = store(18);
    const form = createForm({
      schema: { age: 16 },
      validation: (values: { age: number }, ctx) =>
        values.age >= ctx.read(minAge) ? null : { age: "Too young" },
    });

    // Each scope sees its own value of the tracked store when validation reads it.
    await scoped(scopeA, async () => {
      minAge.value = 18;
      await form.validate();
      expect(readStoreSnapshot(form.errors)).toEqual({ age: "Too young" });
    });
    await scoped(scopeB, async () => {
      minAge.value = 10;
      await form.validate();
      expect(readStoreSnapshot(form.errors)).toEqual({ age: null });
    });
    // Reads are scope-correct: A stayed errored, B stayed clean.
    await scoped(scopeA, async () => {
      expect(readStoreSnapshot(form.errors)).toEqual({ age: "Too young" });
      expect(form.isValid.value).toBe(false);
    });
    await scoped(scopeB, async () => {
      expect(readStoreSnapshot(form.errors)).toEqual({ age: null });
      expect(form.isValid.value).toBe(true);
    });
  });

  it("does not leak the active scope after a detached dependency-tracker revalidation", async () => {
    const appScope = scope();
    const minAge = store(18);
    const form = createForm({
      schema: { age: 16 },
      validation: (values: { age: number }, ctx) =>
        values.age >= ctx.read(minAge) ? null : { age: "Too young" },
    });

    expect(getCurrentScope()).toBe(null);

    await scoped(appScope, async () => {
      await form.validate();
      expect(readStoreSnapshot(form.errors)).toEqual({ age: "Too young" });
    });
    expect(getCurrentScope()).toBe(null);

    await scoped(appScope, async () => {
      minAge.value = 16;
      // Dependency-tracker reaction re-runs validation detached; pump the queue
      // while keeping the ambient scope (a bare `await tick` would drop it).
      await scoped(() => tick(100));
      expect(readStoreSnapshot(form.errors)).toEqual({ age: null });
      expect(getCurrentScope()).toBe(appScope);
    });
    // The detached revalidation must NOT have written its firing scope back into
    // the ambient global.
    expect(getCurrentScope()).toBe(null);

    // A fresh, unrelated field still validates correctly in its own scope
    // (no contamination from the revalidation above).
    const otherScope = scope();
    const field = createField("", { validate: (value: string) => (value ? null : "req") });
    await scoped(otherScope, async () => {
      await field.validate();
      expect(field.error.value).toBe("req");
    });
    expect(getCurrentScope()).toBe(null);
  });

  it("runs change-strategy validation under scope without leaking", async () => {
    const appScope = scope();
    const form = createForm({
      schema: { name: "" },
      validation: (values: { name: string }) =>
        values.name ? null : { name: "Required" },
      validationStrategies: ["change"],
    });

    await scoped(appScope, async () => {
      await form.fill({ values: { name: "" } });
      expect(readStoreSnapshot(form.errors)).toEqual({ name: "Required" });
      expect(getCurrentScope()).toBe(appScope);

      await form.fill({ values: { name: "Ada" } });
      expect(readStoreSnapshot(form.errors)).toEqual({ name: null });
    });
    expect(getCurrentScope()).toBe(null);
  });

  it("ignores a superseded validation's stale result", async () => {
    const appScope = scope();
    const slow = deferred<string | null>();
    const fast = deferred<string | null>();
    const abortedValues: string[] = [];
    const field = createField<string>("slow", {
      validate(value: string, ctx) {
        if (value === "slow") {
          ctx.signal.addEventListener(
            "abort",
            () => {
              abortedValues.push(value);
              // The stale run tries to resolve late with an error...
              slow.resolve("Stale error");
            },
            { once: true },
          );
          return slow.promise;
        }
        return fast.promise;
      },
    });
    const validated = watchCalls(field.validated);
    const failed = watchCalls(field.validationFailed);
    const errorsChanged = watchCalls(field.errorsChanged);

    await scoped(appScope, async () => {
      const first = field.validate();
      await tick();
      await field.fill("fast");
      const second = field.validate();

      fast.resolve(null);
      await second;
      await first;

      // The first run was aborted (its signal fired) and its late "Stale error"
      // result was discarded: no error written, and only the winning run emitted.
      expect(abortedValues).toEqual(["slow"]);
      expect(field.error.value).toBe(null);
      expect(validated).toEqual(["fast"]);
      expect(failed).toEqual([]);
      // errorsChanged only from the successful run (cleared error).
      expect(errorsChanged).toEqual([null]);
    });
  });

  it("isolates values, errors and validation results per scope on one instance", async () => {
    const scopeA = scope();
    const scopeB = scope();
    const form = createForm({
      schema: { name: "" },
      validation: (values: { name: string }) =>
        values.name ? null : { name: "Required" },
    });

    await scoped(scopeA, async () => {
      await form.fill({ values: { name: "A" } });
      await form.validate();
    });
    await scoped(scopeB, async () => {
      await form.validate();
    });

    await scoped(scopeA, async () => {
      expect(readStoreSnapshot(form.values)).toEqual({ name: "A" });
      expect(readStoreSnapshot(form.errors)).toEqual({ name: null });
      expect(form.isValid.value).toBe(true);
    });
    await scoped(scopeB, async () => {
      expect(readStoreSnapshot(form.values)).toEqual({ name: "" });
      expect(readStoreSnapshot(form.errors)).toEqual({ name: "Required" });
      expect(form.isValid.value).toBe(false);
    });
  });

  it("isolates a single field's value and error across two scopes", async () => {
    const scopeA = scope();
    const scopeB = scope();
    const field = createField("base");

    await scoped(scopeA, async () => {
      await field.fill("A");
      await field.setOuterError("errA");
    });

    // scopeB never touched the field: it still sees the initial value / no error.
    await scoped(scopeA, () => {
      expect(field.state.value).toBe("A");
      expect(field.error.value).toBe("errA");
      expect(field.isValid.value).toBe(false);
    });
    await scoped(scopeB, () => {
      expect(field.state.value).toBe("base");
      expect(field.error.value).toBe(null);
      expect(field.isValid.value).toBe(true);
    });
  });

  it("keeps a synthesized normalized event stable while isolating its emissions per scope", async () => {
    const scopeA = scope();
    const scopeB = scope();
    const child = createField("");
    // Omit `fill` entirely so the synthesized fill traverses children instead of
    // delegating to a field method.
    const group = {
      kind: "group",
      state: computed(() => ({ child: child.state.value })),
      fields: { child },
    } as unknown as FieldContract<unknown, unknown, unknown>;
    const normalized = normalizeField(group);
    const changes = watchCalls(child.changed);

    await scoped(scopeA, async () => {
      await normalized.fill({ child: "from-a" });
      expect(child.state.value).toBe("from-a");
    });
    await scoped(scopeB, async () => {
      expect(child.state.value).toBe("");
    });

    // Same synthesized fill effect used across both scopes.
    expect(normalizeField(group).fill).toBe(normalized.fill);
    expect(changes).toContain("from-a");
  });
});
