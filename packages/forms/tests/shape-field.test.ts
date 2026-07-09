import { describe, expect, it } from "vitest";
import { getCurrentScope, scope, scoped, store } from "@virentia/core";
import {
  createArrayField,
  createField,
  createShapeField,
  readStoreSnapshot,
  type ValidationContext,
} from "../lib";
import { deferred, tick, watchCalls } from "./_helpers";

describe("createShapeField", () => {
  describe("construction", () => {
    it("exposes kind 'shape'", () => {
      const shape = createShapeField({ a: createField("x") });
      expect(shape.kind).toBe("shape");
    });

    it("wraps raw values as leaf fields while keeping field contracts by identity", async () => {
      const appScope = scope();
      const contract = createField("kept");
      const shape = createShapeField(
        {
          title: contract,
          count: 5,
          flag: false,
        },
        {},
      );

      await scoped(appScope, async () => {
        const fields = shape.readFields();
        // Field contract kept by identity.
        expect(fields.title).toBe(contract);
        // Raw values wrapped into leaf fields.
        expect(fields.count.kind).toBe("field");
        expect(fields.flag.kind).toBe("field");
        expect(readStoreSnapshot(shape.state)).toEqual({
          title: "kept",
          count: 5,
          flag: false,
        });
      });
    });

    it("invokes options.createField only for raw values, not field contracts", async () => {
      const appScope = scope();
      const created: string[] = [];
      const contract = createField("kept");
      const shape = createShapeField(
        { title: contract, count: 5, tag: "raw" },
        {
          createField(key, value) {
            created.push(`${key}:${String(value)}`);
            return createField(value);
          },
        },
      );
      // Only raw entries flow through createField; contracts are left untouched.
      expect(created).toEqual(["count:5", "tag:raw"]);
      await scoped(appScope, async () => {
        expect(shape.readFields().title).toBe(contract);
      });
    });

    it("starts empty with empty state, empty errors, valid and no fields", async () => {
      const appScope = scope();
      const shape = createShapeField({});

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(shape.state)).toEqual({});
        expect(readStoreSnapshot(shape.errors)).toEqual({});
        expect(readStoreSnapshot(shape.isValid)).toBe(true);
        expect(shape.readFields()).toEqual({});
      });
    });

    it("wraps a raw plain-object value as a leaf field, not a nested shape", async () => {
      const appScope = scope();
      const shape = createShapeField({ meta: { a: 1 } }, {});

      await scoped(appScope, async () => {
        // Raw object goes through createField -> a leaf field holding the object.
        expect(shape.readFields().meta.kind).toBe("field");
        expect(readStoreSnapshot(shape.state)).toEqual({ meta: { a: 1 } });
        // Errors are flat (leaf), not a nested object.
        expect(readStoreSnapshot(shape.errors)).toEqual({ meta: null });
      });
    });
  });

  describe("reading", () => {
    it("reads the child value map through state, read, fields, readFields and serialize", async () => {
      const appScope = scope();
      const shape = createShapeField({
        title: createField("Hello"),
        slug: createField("hello"),
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hello", slug: "hello" });
        expect(shape.read()).toEqual({ title: "Hello", slug: "hello" });
        expect(Object.keys(readStoreSnapshot(shape.fields))).toEqual(["title", "slug"]);
        expect(Object.keys(shape.readFields())).toEqual(["title", "slug"]);
        expect(shape.serialize?.()).toEqual({
          value: { title: "Hello", slug: "hello" },
          errors: { title: null, slug: null },
        });
      });
    });

    it("readFields returns the live field object, reflecting later adds", async () => {
      const appScope = scope();
      const shape = createShapeField({ a: createField("x") });

      await scoped(appScope, async () => {
        const fields = shape.readFields();
        expect(fields.a.kind).toBe("field");
        await shape.add({ key: "b", field: createField("y") });
        expect(Object.keys(shape.readFields())).toEqual(["a", "b"]);
      });
    });

    it("reads nested shape and array children recursively", async () => {
      const appScope = scope();
      const shape = createShapeField({
        profile: createShapeField({ name: createField("Ada") }),
        tags: createArrayField(["x", "y"]),
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(shape.state)).toEqual({
          profile: { name: "Ada" },
          tags: ["x", "y"],
        });
      });
    });

    it("serialize surfaces a non-object shape-level error as a bare string", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { a: createField("x") },
        { validate: (): any => "form-level" },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        expect(shape.serialize?.()).toEqual({
          value: { a: "x" },
          // own inner box wins in the `errors` view -> serialize.errors is a raw string.
          errors: "form-level",
        });
      });
    });

    it("serialize surfaces the combined child error map", async () => {
      const appScope = scope();
      const shape = createShapeField({
        title: createField("Hello"),
        slug: createField("hello"),
      });

      await scoped(appScope, async () => {
        await shape.setOuterErrors({ title: "Server title" } as never);
        expect(shape.serialize?.()).toEqual({
          value: { title: "Hello", slug: "hello" },
          errors: { title: "Server title", slug: null },
        });
      });
    });
  });

  describe("dynamic keys", () => {
    it("emits changed with the full value map after each add, replace, remove and clear", async () => {
      const appScope = scope();
      const shape = createShapeField({ title: createField("Hello") });
      const changed = watchCalls(shape.changed);

      await scoped(appScope, async () => {
        await shape.add({ key: "slug", field: createField("hello") });
        expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hello", slug: "hello" });

        await shape.replace({ key: "title", field: createField("Hi") });
        expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hi", slug: "hello" });

        await shape.remove("slug");
        expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hi" });

        await shape.clear();
        expect(readStoreSnapshot(shape.state)).toEqual({});

        expect(changed).toEqual([
          { title: "Hello", slug: "hello" },
          { title: "Hi", slug: "hello" },
          { title: "Hi" },
          {},
        ]);
      });
    });

    it("emits errorsChanged once per structural mutation", async () => {
      const appScope = scope();
      const shape = createShapeField({ title: createField("Hello") });
      const errorsChanged = watchCalls(shape.errorsChanged);

      await scoped(appScope, async () => {
        await shape.add({ key: "slug", field: createField("hello") });
        await shape.replace({ key: "title", field: createField("Hi") });
        await shape.remove("slug");
        await shape.clear();
        expect(errorsChanged).toHaveLength(4);
      });
    });

    it("treats removing an absent key as a no-op that emits nothing", async () => {
      const appScope = scope();
      const shape = createShapeField({ title: createField("Hi") });
      const changed = watchCalls(shape.changed);
      const errorsChanged = watchCalls(shape.errorsChanged);

      await scoped(appScope, async () => {
        await shape.remove("missing");
        expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hi" });
        expect(changed).toEqual([]);
        expect(errorsChanged).toEqual([]);
      });
    });

    it("adds a new key when replacing an unknown key", async () => {
      const appScope = scope();
      const shape = createShapeField({ title: createField("Hi") });
      const changed = watchCalls(shape.changed);

      await scoped(appScope, async () => {
        await shape.replace({ key: "brandNew", field: createField("added") });
        expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hi", brandNew: "added" });
        expect(changed).toEqual([{ title: "Hi", brandNew: "added" }]);
      });
    });

    it("overwrites an existing key with the new field instance on add", async () => {
      const appScope = scope();
      const first = createField("first");
      const second = createField("second");
      const shape = createShapeField({ title: first });
      const changed = watchCalls(shape.changed);

      await scoped(appScope, async () => {
        await shape.add({ key: "title", field: second });
        expect(shape.readFields().title).toBe(second);
        expect(readStoreSnapshot(shape.state)).toEqual({ title: "second" });
        expect(changed).toEqual([{ title: "second" }]);
      });
    });

    it("empties the shape and drops the own error box to the children view on clear", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { name: createField("v") },
        { validate: (): any => "form-level" },
      );
      const changed = watchCalls(shape.changed);

      await scoped(appScope, async () => {
        await shape.validate();
        // own inner box now holds the shape-level string error.
        expect(readStoreSnapshot(shape.errors)).toBe("form-level");

        await shape.clear();
        expect(readStoreSnapshot(shape.state)).toEqual({});
        // own inner box reset -> errors falls back to (empty) children errors.
        expect(readStoreSnapshot(shape.errors)).toEqual({});
        expect(changed).toEqual([{}]);
      });
    });

    it("emits changed when clearing an already-empty shape", async () => {
      const appScope = scope();
      const shape = createShapeField({});
      const changed = watchCalls(shape.changed);

      await scoped(appScope, async () => {
        await shape.clear();
        expect(changed).toEqual([{}]);
      });
    });

    it("keeps the same field instance across add and read cycles", async () => {
      const appScope = scope();
      const shape = createShapeField({});
      const child = createField("v");

      await scoped(appScope, async () => {
        await shape.add({ key: "a", field: child });
        expect(shape.readFields().a).toBe(child);
        await shape.add({ key: "b", field: createField("w") });
        // adding another key does not swap the earlier instance.
        expect(shape.readFields().a).toBe(child);
      });
    });
  });

  describe("fill", () => {
    it("updates an existing key and creates an unknown key via createField", async () => {
      const appScope = scope();
      const created: string[] = [];
      const untouched = createField("B");
      const shape = createShapeField(
        { title: createField("A"), keep: untouched },
        {
          createField(key, value) {
            created.push(`${key}:${String(value)}`);
            return createField(value);
          },
        },
      );

      await scoped(appScope, async () => {
        await shape.fill({ title: "A2", slug: "new" } as never);

        expect(readStoreSnapshot(shape.state)).toEqual({
          title: "A2",
          keep: "B",
          slug: "new",
        });
      });
    });

    it("leaves an unmentioned key untouched by identity", async () => {
      const appScope = scope();
      const created: string[] = [];
      const untouched = createField("B");
      const shape = createShapeField(
        { title: createField("A"), keep: untouched },
        {
          createField(key, value) {
            created.push(`${key}:${String(value)}`);
            return createField(value);
          },
        },
      );

      await scoped(appScope, async () => {
        await shape.fill({ title: "A2", slug: "new" } as never);
        // "keep" left untouched by identity.
        expect(shape.readFields().keep).toBe(untouched);
      });
    });

    it("invokes options.createField only for the unknown key on fill", async () => {
      const appScope = scope();
      const created: string[] = [];
      const untouched = createField("B");
      const shape = createShapeField(
        { title: createField("A"), keep: untouched },
        {
          createField(key, value) {
            created.push(`${key}:${String(value)}`);
            return createField(value);
          },
        },
      );

      await scoped(appScope, async () => {
        await shape.fill({ title: "A2", slug: "new" } as never);
        // createField only invoked for the unknown key on fill.
        expect(created).toEqual(["slug:new"]);
      });
    });

    it("emits changed once with the full value map on fill", async () => {
      const appScope = scope();
      const created: string[] = [];
      const untouched = createField("B");
      const shape = createShapeField(
        { title: createField("A"), keep: untouched },
        {
          createField(key, value) {
            created.push(`${key}:${String(value)}`);
            return createField(value);
          },
        },
      );
      const changed = watchCalls(shape.changed);

      await scoped(appScope, async () => {
        await shape.fill({ title: "A2", slug: "new" } as never);
        // shape.changed emitted exactly once for the whole fill.
        expect(changed).toEqual([{ title: "A2", keep: "B", slug: "new" }]);
      });
    });

    it("creates an unknown key with the default createField when no option is supplied", async () => {
      const appScope = scope();
      const shape = createShapeField({ a: createField("A") });

      await scoped(appScope, async () => {
        await shape.fill({ b: "B" } as never);
        expect(shape.readFields().b.kind).toBe("field");
        expect(readStoreSnapshot(shape.state)).toEqual({ a: "A", b: "B" });
      });
    });

    it("emits changed once with the full value map when filling an empty object", async () => {
      const appScope = scope();
      const shape = createShapeField({ a: createField("A") });
      const changed = watchCalls(shape.changed);

      await scoped(appScope, async () => {
        await shape.fill({});
        expect(changed).toEqual([{ a: "A" }]);
      });
    });

    it("revalidates existing keys on fill under the change strategy", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { slug: "" },
        {
          validate(values: Record<string, unknown>) {
            return values.slug ? null : { slug: "Slug is required" };
          },
          validationStrategies: ["change"],
        },
      );

      await scoped(appScope, async () => {
        await shape.fill({ slug: "" });
        expect(readStoreSnapshot(shape.errors)).toEqual({ slug: "Slug is required" });

        await shape.fill({ slug: "hello" });
        expect(readStoreSnapshot(shape.errors)).toEqual({ slug: null });
      });
    });

    it("revalidates a newly created key on fill under the change strategy", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { a: "" },
        {
          validate(values: Record<string, unknown>) {
            const errs: Record<string, unknown> = {};
            if (!values.a) errs.a = "a required";
            if (values.b === "bad") errs.b = "b bad";
            return Object.keys(errs).length ? errs : null;
          },
          validationStrategies: ["change"],
        },
      );

      await scoped(appScope, async () => {
        await shape.fill({ a: "x", b: "bad" } as never);
        // b was created on fill, then the shape validator distributed its error.
        expect(readStoreSnapshot(shape.errors)).toEqual({ a: null, b: "b bad" });
      });
    });

    it("delegates fill recursively into a nested shape child, preserving untouched siblings", async () => {
      const appScope = scope();
      const shape = createShapeField({
        profile: createShapeField({
          name: createField("Ada"),
          age: createField(1),
        }),
      });

      await scoped(appScope, async () => {
        await shape.fill({ profile: { name: "Bob" } } as never);
        // Only the addressed leaf changed; the untouched sibling is preserved.
        expect(readStoreSnapshot(shape.state)).toEqual({
          profile: { name: "Bob", age: 1 },
        });
      });
    });
  });

  describe("reset", () => {
    it("restores the initial field set by identity and drops dynamic keys", async () => {
      const appScope = scope();
      const initialTitle = createField("Hello");
      const shape = createShapeField({ title: initialTitle });

      await scoped(appScope, async () => {
        await shape.add({ key: "slug", field: createField("hello") });
        await shape.replace({ key: "title", field: createField("Swapped") });
        await shape.fill({ title: "Hi" });
        await shape.setOuterErrors({ title: "Server" });

        await shape.reset();

        // Only the initial key survives, and it is the ORIGINAL instance.
        expect(shape.readFields()).toEqual({ title: initialTitle });
        expect(shape.readFields().title).toBe(initialTitle);
        expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hello" });
        expect(readStoreSnapshot(shape.errors)).toEqual({ title: null });
      });
    });

    it("clears the own error box and restores each child value and error", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { name: createField("orig") },
        { validate: (): any => "form-level" },
      );
      const changed = watchCalls(shape.changed);

      await scoped(appScope, async () => {
        await shape.fill({ name: "changed" });
        await shape.validate();
        expect(readStoreSnapshot(shape.errors)).toBe("form-level");

        await shape.reset();
        // own inner box cleared -> falls back to children errors.
        expect(readStoreSnapshot(shape.errors)).toEqual({ name: null });
        expect(readStoreSnapshot(shape.state)).toEqual({ name: "orig" });
        // reset emits changed with the restored value.
        expect(changed.at(-1)).toEqual({ name: "orig" });
      });
    });
  });

  describe("error model", () => {
    it("surfaces a non-object shape error in place of the child error view", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { name: createField("v") },
        { validate: (): any => "form-level" },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        // ownInner set -> errors is the raw string, NOT an object.
        expect(readStoreSnapshot(shape.errors)).toBe("form-level");
        // innerErrors always reads the per-child objects regardless of ownInner.
        expect(readStoreSnapshot(shape.innerErrors)).toEqual({ name: null });
        expect(readStoreSnapshot(shape.isValid)).toBe(false);
      });
    });

    it("exposes inner and outer errors as per-child maps, preferring outer in the combined view", async () => {
      const appScope = scope();
      const shape = createShapeField({
        a: createField("a"),
        b: createField("b"),
      });

      await scoped(appScope, async () => {
        await shape.setInnerErrors({ a: "inner-a" } as never);
        await shape.setOuterErrors({ b: "outer-b" } as never);
        expect(readStoreSnapshot(shape.innerErrors)).toEqual({ a: "inner-a", b: null });
        expect(readStoreSnapshot(shape.outerErrors)).toEqual({ a: null, b: "outer-b" });
        // combined errors prefer outer over inner per child.
        expect(readStoreSnapshot(shape.errors)).toEqual({ a: "inner-a", b: "outer-b" });
      });
    });

    it("clears the own error box and distributes to children on setInnerErrors", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { name: createField("v") },
        { validate: (): any => "form-level" },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        expect(readStoreSnapshot(shape.errors)).toBe("form-level");

        await shape.setInnerErrors({ name: "per-field" });
        // own box cleared -> errors is once again a per-child object.
        expect(readStoreSnapshot(shape.errors)).toEqual({ name: "per-field" });
        expect(readStoreSnapshot(shape.innerErrors)).toEqual({ name: "per-field" });
      });
    });

    it("leaves unmentioned children's inner errors stale on a partial setInnerErrors", async () => {
      const appScope = scope();
      const shape = createShapeField({
        a: createField("A"),
        b: createField("B"),
      });

      await scoped(appScope, async () => {
        await shape.setInnerErrors({ a: "errA", b: "errB" });
        await shape.setInnerErrors({ a: "errA2" } as never);
        // b was NOT reset by the second partial call.
        expect(readStoreSnapshot(shape.errors)).toEqual({ a: "errA2", b: "errB" });
      });
    });

    it("drops unknown keys and merges dotted paths with nested objects on setInnerErrors", async () => {
      const appScope = scope();
      const shape = createShapeField({
        profile: createShapeField({
          first: createField("f"),
          last: createField("l"),
        }),
        slug: createField("s"),
      });

      await scoped(appScope, async () => {
        await shape.setInnerErrors({
          "profile.first": "First bad",
          profile: { last: "Last bad" },
          slug: "Slug bad",
          unknownKey: "dropped",
        } as never);
        expect(readStoreSnapshot(shape.innerErrors)).toEqual({
          profile: { first: "First bad", last: "Last bad" },
          slug: "Slug bad",
        });
      });
    });

    it("distributes to children without a shape-level box on setOuterErrors", async () => {
      const appScope = scope();
      const shape = createShapeField({
        title: createField("Hello"),
        slug: createField("hello"),
      });

      await scoped(appScope, async () => {
        await shape.setOuterErrors({ title: "Server title" } as never);
        expect(readStoreSnapshot(shape.errors)).toEqual({ title: "Server title", slug: null });
        // there is no own outer box: outerErrors reads purely from children.
        expect(readStoreSnapshot(shape.outerErrors)).toEqual({ title: "Server title", slug: null });
      });
    });

    it("spreads a string's characters onto index-matching keys on setOuterErrors", async () => {
      const appScope = scope();
      const shape = createShapeField({
        "0": createField("orig"),
        name: createField("n"),
      });

      await scoped(appScope, async () => {
        await shape.setOuterErrors("XY" as never);
        // "XY" -> {"0":"X","1":"Y"}; only the "0" key matches a child.
        expect(readStoreSnapshot(shape.errors)).toEqual({ "0": "X", name: null });
      });
    });

    it("clears the own box and every child's inner error on clearInnerErrors", async () => {
      const appScope = scope();
      const shape = createShapeField(
        {
          nested: createShapeField({ title: createField("Hello") }),
          slug: createField("hello"),
        },
        { validate: (): any => "form-level" },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        await shape.setInnerErrors({ nested: { title: "Too short" }, slug: "Bad slug" });
        expect(readStoreSnapshot(shape.innerErrors)).toEqual({
          nested: { title: "Too short" },
          slug: "Bad slug",
        });

        await shape.clearInnerErrors();
        expect(readStoreSnapshot(shape.errors)).toEqual({
          nested: { title: null },
          slug: null,
        });
      });
    });

    it("clears every child's outer error on clearOuterErrors", async () => {
      const appScope = scope();
      const shape = createShapeField({
        a: createField("a"),
        b: createField("b"),
      });

      await scoped(appScope, async () => {
        await shape.setOuterErrors({ a: "server-a", b: "server-b" });
        expect(readStoreSnapshot(shape.errors)).toEqual({ a: "server-a", b: "server-b" });

        await shape.clearOuterErrors();
        expect(readStoreSnapshot(shape.errors)).toEqual({ a: null, b: null });
      });
    });

    it("recurses into nested shape children when applying and clearing outer errors", async () => {
      const appScope = scope();
      const shape = createShapeField({
        profile: createShapeField({
          name: createField("Ada"),
        }),
      });

      await scoped(appScope, async () => {
        await shape.setOuterErrors({ profile: { name: "Server name" } });
        expect(readStoreSnapshot(shape.errors)).toEqual({ profile: { name: "Server name" } });

        await shape.clearOuterErrors();
        expect(readStoreSnapshot(shape.errors)).toEqual({ profile: { name: null } });
      });
    });

    it("treats empty-string and zero error values as real errors", async () => {
      const appScope = scope();
      const shape = createShapeField({
        es: createField("x"),
        zero: createField("y"),
        ok: createField("z"),
      });

      await scoped(appScope, async () => {
        await shape.setInnerErrors({ es: "", zero: 0 } as never);
        expect(readStoreSnapshot(shape.errors)).toEqual({ es: "", zero: 0, ok: null });
        expect(readStoreSnapshot(shape.isValid)).toBe(false);
      });
    });

    it("treats a null error value as no error", async () => {
      const appScope = scope();
      const shape = createShapeField({ a: createField("x") });

      await scoped(appScope, async () => {
        await shape.setInnerErrors({ a: null });
        expect(readStoreSnapshot(shape.errors)).toEqual({ a: null });
        expect(readStoreSnapshot(shape.isValid)).toBe(true);
      });
    });

    it("leaves unmentioned children's outer errors stale on a partial setOuterErrors", async () => {
      const appScope = scope();
      const shape = createShapeField({
        a: createField("A"),
        b: createField("B"),
      });

      await scoped(appScope, async () => {
        await shape.setOuterErrors({ a: "sa", b: "sb" } as never);
        await shape.setOuterErrors({ a: "sa2" } as never);
        // Only `a` was rewritten; `b` retains its stale outer error (no clear path).
        expect(readStoreSnapshot(shape.outerErrors)).toEqual({ a: "sa2", b: "sb" });
        expect(readStoreSnapshot(shape.errors)).toEqual({ a: "sa2", b: "sb" });
      });
    });

    it("emits errorsChanged from every error mutator", async () => {
      const appScope = scope();
      const shape = createShapeField({ a: createField("A") });
      const errorsChanged = watchCalls(shape.errorsChanged);

      await scoped(appScope, async () => {
        await shape.setInnerErrors({ a: "i" } as never);
        await shape.setOuterErrors({ a: "o" } as never);
        await shape.clearInnerErrors();
        await shape.clearOuterErrors();
        expect(errorsChanged).toHaveLength(4);
      });
    });
  });

  describe("validation", () => {
    it("validates children before the shape validator, distributing an object result to children", async () => {
      const appScope = scope();
      const order: string[] = [];
      const shape = createShapeField(
        {
          title: createField("", {
            validate: (value: string) => {
              order.push("child:title");
              return value ? null : "Title is required";
            },
          }),
          slug: createField("reserved"),
        },
        {
          validate(values: Record<string, unknown>) {
            order.push("shape");
            return values.slug === "reserved" ? { slug: "Slug is reserved" } : null;
          },
        },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        expect(readStoreSnapshot(shape.errors)).toEqual({
          title: "Title is required",
          slug: "Slug is reserved",
        });
        // children validated before the shape validator.
        expect(order).toEqual(["child:title", "shape"]);
      });
    });

    it("distributes an object validator result to children's inner errors", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { slug: createField("reserved") },
        {
          validate(values: Record<string, unknown>) {
            return values.slug === "reserved" ? { slug: "reserved!" } : null;
          },
        },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        expect(readStoreSnapshot(shape.errors)).toEqual({ slug: "reserved!" });
        expect(readStoreSnapshot(shape.innerErrors)).toEqual({ slug: "reserved!" });
      });
    });

    it("stores a non-object validator result in the own error box", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { a: createField("x") },
        { validate: (): any => "whole-form-error" },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        expect(readStoreSnapshot(shape.errors)).toBe("whole-form-error");
        expect(readStoreSnapshot(shape.isValid)).toBe(false);
      });
    });

    it("clears previously distributed child errors when re-validation now passes", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { slug: createField("reserved") },
        {
          validate(values: Record<string, unknown>) {
            return values.slug === "reserved" ? { slug: "Slug is reserved" } : null;
          },
        },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        expect(readStoreSnapshot(shape.errors)).toEqual({ slug: "Slug is reserved" });

        await shape.fill({ slug: "free" });
        await shape.validate();
        // child.validate rewrote inner to null and the shape validator now passes.
        expect(readStoreSnapshot(shape.errors)).toEqual({ slug: null });
      });
    });

    it("clears a passing child field's error on re-validation", async () => {
      const appScope = scope();
      const shape = createShapeField(
        {
          title: createField("", {
            validate: (value: string) => (value ? null : "Title is required"),
          }),
          slug: createField("reserved"),
        },
        {
          validate(values: Record<string, unknown>) {
            return values.slug === "reserved" ? { slug: "Slug is reserved" } : null;
          },
        },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        await shape.fill({ title: "Hello", slug: "hello" });
        await shape.validate();
        expect(readStoreSnapshot(shape.errors)).toEqual({ title: null, slug: null });
      });
    });

    it("emits validationFailed on failure and validated on success with the values payload", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { name: createField("") },
        {
          validate(values: Record<string, unknown>) {
            return values.name ? null : { name: "required" };
          },
        },
      );
      const validated = watchCalls(shape.validated);
      const validationFailed = watchCalls(shape.validationFailed);
      const errorsChanged = watchCalls(shape.errorsChanged);

      await scoped(appScope, async () => {
        await shape.validate();
        expect(validationFailed).toEqual([{ name: "" }]);
        expect(validated).toEqual([]);

        await shape.fill({ name: "Ada" });
        await shape.validate();
        expect(validated).toEqual([{ name: "Ada" }]);
        // errorsChanged fired for each validation run.
        expect(errorsChanged.length).toBeGreaterThanOrEqual(2);
      });
    });

    it("emits validated for an empty shape with no validators", async () => {
      const appScope = scope();
      const shape = createShapeField({});
      const validated = watchCalls(shape.validated);

      await scoped(appScope, async () => {
        await shape.validate();
        expect(validated).toEqual([{}]);
      });
    });

    it("validates nested shape children recursively", async () => {
      const appScope = scope();
      const shape = createShapeField({
        profile: createShapeField({
          name: createField("", {
            validate: (value: string) => (value ? null : "Name required"),
          }),
        }),
      });

      await scoped(appScope, async () => {
        await shape.validate();
        expect(readStoreSnapshot(shape.errors)).toEqual({ profile: { name: "Name required" } });
      });
    });

    it("reports isValidationPending while an async shape validator is in flight", async () => {
      const appScope = scope();
      const gate = deferred<Record<string, unknown> | null>();
      const shape = createShapeField(
        { a: createField("x") },
        { validate: () => gate.promise },
      );
      const pendingCalls = watchCalls(shape.isValidationPending);

      await scoped(appScope, async () => {
        const run = shape.validate();
        await tick();
        expect(readStoreSnapshot(shape.isValidationPending)).toBe(true);

        gate.resolve(null);
        await run;
        expect(readStoreSnapshot(shape.isValidationPending)).toBe(false);
        expect(pendingCalls.at(-1)).toBe(false);
      });
    });

    it("reports isValidationPending while an async child validator is in flight", async () => {
      const appScope = scope();
      const gate = deferred<string | null>();
      const shape = createShapeField({
        a: createField("x", { validate: () => gate.promise }),
      });

      await scoped(appScope, async () => {
        const run = shape.validate();
        await tick();
        expect(readStoreSnapshot(shape.isValidationPending)).toBe(true);

        gate.resolve(null);
        await run;
        expect(readStoreSnapshot(shape.isValidationPending)).toBe(false);
      });
    });

    it("stores null in the own box for an undefined validator result, falling back to children", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { a: createField("x") },
        { validate: (): any => undefined },
      );
      const validated = watchCalls(shape.validated);

      await scoped(appScope, async () => {
        await shape.validate();
        // undefined result -> own inner box is null, so errors is the per-child object.
        expect(readStoreSnapshot(shape.errors)).toEqual({ a: null });
        expect(readStoreSnapshot(shape.isValid)).toBe(true);
        expect(validated).toEqual([{ a: "x" }]);
      });
    });

    it("distributes only the mentioned children on an object result, leaving others null", async () => {
      const appScope = scope();
      const shape = createShapeField(
        { a: createField("x"), b: createField("y"), c: createField("z") },
        { validate: (): any => ({ b: "only b" }) },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        expect(readStoreSnapshot(shape.errors)).toEqual({ a: null, b: "only b", c: null });
        expect(readStoreSnapshot(shape.isValid)).toBe(false);
      });
    });
  });

  describe("scope", () => {
    it("revalidates on a dependency-store change without leaking the active scope", async () => {
      const appScope = scope();
      const minLen = store(3);
      const shape = createShapeField(
        { name: createField("ab") },
        {
          validate(values: Record<string, unknown>, ctx: ValidationContext) {
            return (values.name as string).length >= ctx.read(minLen)
              ? null
              : { name: "Too short" };
          },
        },
      );

      await scoped(appScope, async () => {
        await shape.validate();
        expect(readStoreSnapshot(shape.errors)).toEqual({ name: "Too short" });

        minLen.value = 2;
        // Pump the detached dependency-tracker revalidation while keeping ambient scope.
        await scoped(() => tick(100));
        expect(readStoreSnapshot(shape.errors)).toEqual({ name: null });
        // Ambient scope is still appScope inside the outer scoped block.
        expect(getCurrentScope()).toBe(appScope);
      });

      // Once the outer scope settles, nothing leaked into the global active scope.
      expect(getCurrentScope()).toBe(null);
    });

    it("isolates state across two scopes on one instance", async () => {
      const scopeA = scope();
      const scopeB = scope();
      const shape = createShapeField({ name: createField("start") });

      await scoped(scopeA, async () => {
        await shape.fill({ name: "A" });
      });
      await scoped(scopeB, async () => {
        await shape.fill({ name: "B" });
      });

      await scoped(scopeA, async () => {
        expect(readStoreSnapshot(shape.state)).toEqual({ name: "A" });
      });
      await scoped(scopeB, async () => {
        expect(readStoreSnapshot(shape.state)).toEqual({ name: "B" });
      });
    });

    it("aborts a superseded validation and discards its stale late result", async () => {
      const appScope = scope();
      const slow = deferred<Record<string, unknown> | null>();
      const fast = deferred<Record<string, unknown> | null>();
      const started = deferred<void>();
      const aborted: string[] = [];
      const shape = createShapeField(
        { name: createField("x") },
        {
          validate(values: Record<string, unknown>, ctx: ValidationContext) {
            if ((values.name as string) === "x") {
              // Signal that the slow run parked on `slow.promise` so the test can
              // supersede it deterministically (the child-validation phase makes a
              // single tick unreliable).
              started.resolve();
              ctx.signal.addEventListener(
                "abort",
                () => {
                  aborted.push("slow");
                  slow.resolve({ name: "Stale error" });
                },
                { once: true },
              );
              return slow.promise;
            }
            return fast.promise;
          },
        },
      );

      await scoped(appScope, async () => {
        const first = shape.validate();
        await started.promise;
        await shape.fill({ name: "y" });
        const second = shape.validate();

        fast.resolve(null);
        await second;
        await first;

        expect(aborted).toEqual(["slow"]);
        // The stale { name: "Stale error" } was discarded after the abort.
        expect(readStoreSnapshot(shape.errors)).toEqual({ name: null });
      });
    });
  });
});
