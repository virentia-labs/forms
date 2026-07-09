import { describe, expect, it } from "vitest";
import {
  computed,
  effect,
  getCurrentScope,
  reaction,
  scope,
  scoped,
  store,
} from "@virentia/core";
import {
  createArrayField,
  createField,
  createForm,
  readStoreSnapshot,
  type FieldContract,
  type ValidationContext,
  type ValidationPayload,
} from "../lib";
import { deferred, tick, watchCalls } from "./_helpers";

describe("createForm", () => {
  describe("schema normalization", () => {
    it("keeps a field contract as-is", async () => {
      const appScope = scope();
      const name = createField("seed");
      const form = createForm({ schema: { name } });

      expect(form.fields.name).toBe(name);

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(form.values)).toEqual({ name: "seed" });
      });
    });

    it("turns a plain object into a nested group recursively at arbitrary depth", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { a: { b: { c: { d: "" } } } },
      });

      // Groups are plain objects of normalized fields, not field contracts.
      expect((form.fields.a as any).kind).toBeUndefined();
      expect((form.fields.a.b.c.d as any).kind).toBe("field");

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(form.values)).toEqual({
          a: { b: { c: { d: "" } } },
        });
      });
    });

    it("wraps an array value as one field, not a group", async () => {
      const appScope = scope();
      const form = createForm({ schema: { tags: [] as string[] } });

      expect((form.fields.tags as any).kind).toBe("field");
      expect(typeof form.fields.tags.fill).toBe("function");

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(form.values)).toEqual({ tags: [] });
      });
    });

    it("wraps a Date value as one field, not a group", async () => {
      const appScope = scope();
      const when = new Date("2020-01-01T00:00:00.000Z");
      const form = createForm({ schema: { when } });

      expect((form.fields.when as any).kind).toBe("field");

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(form.values).when).toBeInstanceOf(Date);
        expect(readStoreSnapshot(form.values).when.getTime()).toBe(when.getTime());
      });
    });

    it("wraps primitives (string, number, boolean) as single fields", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { s: "", n: 0, b: false },
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(form.values)).toEqual({ s: "", n: 0, b: false });
      });
    });

    it("accepts an empty schema that is always valid and never changed", async () => {
      const appScope = scope();
      const form = createForm({ schema: {} });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(form.values)).toEqual({});
        expect(form.isValid.value).toBe(true);
        expect(form.isChanged.value).toBe(false);
        // validate on an empty schema is a no-op that still resolves + emits validated
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({});
      });
    });
  });

  describe("stores and aliases", () => {
    it("exposes value as the same store reference as values", () => {
      const form = createForm({ schema: { name: "" } });
      expect(form.value).toBe(form.values);
    });

    it("mirrors schema shape across errors / innerErrors / outerErrors", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "", profile: { email: "" } },
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(form.errors)).toEqual({
          name: null,
          profile: { email: null },
        });
        expect(readStoreSnapshot(form.innerErrors)).toEqual({
          name: null,
          profile: { email: null },
        });
        expect(readStoreSnapshot(form.outerErrors)).toEqual({
          name: null,
          profile: { email: null },
        });
      });
    });

    it("seeds snapshot from the initial values before any change", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "seed", age: 7 } });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "seed", age: 7 });
        expect(form.isChanged.value).toBe(false);
      });
    });

    it("tracks isChanged as deep inequality between values and snapshot", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "" } });

      await scoped(appScope, async () => {
        expect(form.isChanged.value).toBe(false);
        await form.fill({ values: { name: "x" } });
        expect(form.isChanged.value).toBe(true);
        await form.fill({ values: { name: "" } });
        // back to snapshot value → not changed again
        expect(form.isChanged.value).toBe(false);
      });
    });

    it("reflects isValid as hasErrors over the merged errors", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "" } });

      await scoped(appScope, async () => {
        expect(form.isValid.value).toBe(true);
        await form.fill({ errors: { name: "bad" } });
        expect(form.isValid.value).toBe(false);
        await form.clearOuterErrors();
        expect(form.isValid.value).toBe(true);
      });
    });

    it("counts an empty-string error value as an error, making isValid false", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "" } });

      await scoped(appScope, async () => {
        await form.fill({ errors: { name: "" } });
        // hasErrors treats any non-null/undefined scalar (incl. "") as an error
        expect(readStoreSnapshot(form.errors)).toEqual({ name: "" });
        expect(form.isValid.value).toBe(false);
      });
    });

    it("diverges innerErrors, outerErrors and errors by channel, with outer winning in errors", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: (values: { name: string }) =>
          values.name ? null : { name: "inner required" },
      });

      await scoped(appScope, async () => {
        await form.fill({ errors: { name: "outer server" } });
        await form.validate();

        expect(readStoreSnapshot(form.innerErrors)).toEqual({
          name: "inner required",
        });
        expect(readStoreSnapshot(form.outerErrors)).toEqual({
          name: "outer server",
        });
        // effective error: outer takes precedence
        expect(readStoreSnapshot(form.errors)).toEqual({ name: "outer server" });
      });
    });

    it("marks isChanged when a Date field's value changes, comparing dates by instant", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { when: new Date("2020-01-01T00:00:00.000Z") },
      });

      await scoped(appScope, async () => {
        const next = new Date("2021-06-15T00:00:00.000Z");
        await form.fill({ values: { when: next } });

        // the value really changed
        expect(readStoreSnapshot(form.values).when.getTime()).toBe(next.getTime());
        // …and isChanged is true because deepEqual special-cases Dates (getTime())
        expect(form.isChanged.value).toBe(true);
      });
    });
  });

  describe("validation", () => {
    it("emits errorsChanged exactly twice per successful run, clearing then applying", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: () => ({ name: "bad" }),
      });
      const errorsChanged = watchCalls(form.errorsChanged);

      await scoped(appScope, async () => {
        await form.validate();
        expect(errorsChanged).toHaveLength(2);
        expect(errorsChanged[0]).toEqual({ name: null }); // after inner clear
        expect(errorsChanged[1]).toEqual({ name: "bad" }); // after apply
      });
    });

    it("routes form-validator errors to the inner channel, leaving outer untouched", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: () => ({ name: "from validator" }),
      });

      await scoped(appScope, async () => {
        await form.fill({ errors: { name: "outer kept" } });
        await form.validate();

        expect(readStoreSnapshot(form.innerErrors)).toEqual({
          name: "from validator",
        });
        expect(readStoreSnapshot(form.outerErrors)).toEqual({
          name: "outer kept",
        });
      });
    });

    it("never touches outer errors", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: () => null,
      });

      await scoped(appScope, async () => {
        await form.fill({ errors: { name: "server" } });
        await form.validate();
        expect(readStoreSnapshot(form.outerErrors)).toEqual({ name: "server" });
      });
    });

    it("emits validated on success and validationFailed on failure", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: (values: { name: string }) =>
          values.name ? null : { name: "req" },
      });
      const validated = watchCalls(form.validated);
      const failed = watchCalls(form.validationFailed);

      await scoped(appScope, async () => {
        await form.validate();
        expect(failed).toEqual([{ name: "" }]);
        expect(validated).toEqual([]);

        await form.fill({ values: { name: "ok" } });
        await form.validate();
        expect(validated.at(-1)).toEqual({ name: "ok" });
      });
    });

    it("applies only the first failing validator's errors from an array", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { a: "", b: "" },
        validation: [() => ({ a: "first" }), () => ({ b: "second" })],
      });

      await scoped(appScope, async () => {
        await form.validate();
        // only the first validator's errors are applied
        expect(readStoreSnapshot(form.errors)).toEqual({ a: "first", b: null });
      });
    });

    it("skips passing validators and applies the first one that returns errors", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { a: "", b: "" },
        validation: [() => null, () => ({ b: "second wins" })],
      });

      await scoped(appScope, async () => {
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({ a: null, b: "second wins" });
      });
    });

    it("accepts a single Virentia effect as validation", async () => {
      const appScope = scope();
      const validateFx = effect<ValidationPayload<{ name: string }>, { name: string } | null>(
        (payload) => (payload.value.name ? null : { name: "effect required" }),
      );
      const form = createForm({ schema: { name: "" }, validation: validateFx });

      await scoped(appScope, async () => {
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({ name: "effect required" });
        await form.fill({ values: { name: "ok" } });
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({ name: null });
      });
    });

    it("applies the first failing effect from an array and skips a passing earlier one", async () => {
      const appScope = scope();
      const fx1 = effect<
        ValidationPayload<{ a: string; b: string }>,
        { a: string } | null
      >(() => null);
      const fx2 = effect<
        ValidationPayload<{ a: string; b: string }>,
        { b: string } | null
      >(() => ({ b: "eff2" }));
      const form = createForm({ schema: { a: "", b: "" }, validation: [fx1, fx2] });

      await scoped(appScope, async () => {
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({ a: null, b: "eff2" });
      });
    });

    it("overwrites a field's own inner error with the form validator's error", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          name: createField("", {
            validate: (value: string) => (value ? null : "field: required"),
          }),
        },
        validation: () => ({ name: "form: wins" }),
      });

      await scoped(appScope, async () => {
        await form.validate();
        // child validator sets "field: required", then form validator overwrites it
        expect(readStoreSnapshot(form.innerErrors)).toEqual({ name: "form: wins" });
      });
    });

    it("combines child-validator and form-validator errors across keys", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          name: createField("", {
            validate: (value: string) => (value ? null : "Name required"),
          }),
          email: "",
        },
        validation: (values: { email: string }) =>
          values.email.includes("@") ? null : { email: "Invalid email" },
      });

      await scoped(appScope, async () => {
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({
          name: "Name required",
          email: "Invalid email",
        });
      });
    });

    it("clears both child and form validator errors once the values become valid", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          name: createField("", {
            validate: (value: string) => (value ? null : "Name is required"),
          }),
          email: "",
        },
        validation(values) {
          return values.email.includes("@") ? null : { email: "Invalid email" };
        },
      });

      await scoped(appScope, async () => {
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({
          name: "Name is required",
          email: "Invalid email",
        });

        await form.fill({ values: { name: "Ada", email: "ada@example.com" } });
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({ name: null, email: null });
      });
    });

    it("drops a scalar error returned for a nested group key and deems the form valid", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { profile: { email: "" } },
        validation: () => ({ profile: "whole group bad" }),
      });
      const validated = watchCalls(form.validated);
      const failed = watchCalls(form.validationFailed);

      await scoped(appScope, async () => {
        await form.validate();
        // applyErrorsToSchemaFx only recurses into a group when the value is an object,
        // so the scalar is silently discarded — inner errors keep their cleared shape…
        expect(readStoreSnapshot(form.innerErrors)).toEqual({
          profile: { email: null },
        });
        // …and, because the error never lands, the form reports itself valid.
        expect(form.isValid.value).toBe(true);
        expect(validated).toHaveLength(1);
        expect(failed).toHaveLength(0);
      });
    });
  });

  describe("dependency tracking", () => {
    it("revalidates when a tracked store changes", async () => {
      const appScope = scope();
      const minAge = store(18);
      const form = createForm({
        schema: { age: 16 },
        validation: (values: { age: number }, ctx: ValidationContext) =>
          values.age >= ctx.read(minAge) ? null : { age: "Too young" },
      });

      await scoped(appScope, async () => {
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({ age: "Too young" });

        minAge.value = 16;
        await scoped(() => tick(100));
        expect(readStoreSnapshot(form.errors)).toEqual({ age: null });
      });
    });

    it("installs no reaction when the validator reads no store", async () => {
      const appScope = scope();
      const unrelated = store(0);
      let runs = 0;
      const form = createForm({
        schema: { name: "" },
        validation: () => {
          runs += 1;
          return { name: "always" };
        },
      });

      await scoped(appScope, async () => {
        await form.validate();
        expect(runs).toBe(1);

        unrelated.value = 999;
        await scoped(() => tick(100));
        // no dependency was registered, so the validator did not re-run
        expect(runs).toBe(1);
      });
    });

    it("replaces the scope-bound reaction each run so revalidation still fires after multiple validates", async () => {
      const appScope = scope();
      const threshold = store(5);
      const form = createForm({
        schema: { n: 3 },
        validation: (values: { n: number }, ctx: ValidationContext) =>
          values.n >= ctx.read(threshold) ? null : { n: "too small" },
      });

      await scoped(appScope, async () => {
        await form.validate();
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({ n: "too small" });

        threshold.value = 1;
        await scoped(() => tick(100));
        expect(readStoreSnapshot(form.errors)).toEqual({ n: null });
      });
    });
  });

  describe("fill", () => {
    it("fills only present keys and skips unknown keys", async () => {
      const appScope = scope();
      const form = createForm({ schema: { a: "", b: 0 } });

      await scoped(appScope, async () => {
        await form.fill({ values: { a: "x", zzz: "ignored" } as any });
        expect(readStoreSnapshot(form.values)).toEqual({ a: "x", b: 0 });
      });
    });

    it("fills partial values at the top level and inside nested groups, leaving the rest at defaults", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          name: "",
          age: 0,
          profile: {
            email: "",
            city: "",
          },
        },
      });

      await scoped(appScope, async () => {
        await form.fill({ values: { name: "Ada", profile: { email: "ada@example.com" } } });

        expect(readStoreSnapshot(form.values)).toEqual({
          name: "Ada",
          age: 0,
          profile: { email: "ada@example.com", city: "" },
        });
      });
    });

    it("routes fill errors to the outer channel", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "" } });

      await scoped(appScope, async () => {
        await form.fill({ errors: { name: "server" } });
        expect(readStoreSnapshot(form.outerErrors)).toEqual({ name: "server" });
        expect(readStoreSnapshot(form.innerErrors)).toEqual({ name: null });
      });
    });

    it("emits filled → changed → errorsChanged in order on a values+errors fill", async () => {
      const appScope = scope();
      const form = createForm({ schema: { a: "", b: 0 } });
      const order: string[] = [];
      reaction({ on: form.filled, run: () => order.push("filled") });
      reaction({ on: form.changed, run: () => order.push("changed") });
      reaction({ on: form.errorsChanged, run: () => order.push("errorsChanged") });

      await scoped(appScope, async () => {
        await form.fill({ values: { a: "x", b: 1 }, errors: { b: "bad" } });
        expect(order).toEqual(["filled", "changed", "errorsChanged"]);
      });
    });

    it("still emits filled/changed/errorsChanged with current state on an empty fill", async () => {
      const appScope = scope();
      const form = createForm({ schema: { a: "seed" } });
      const filled = watchCalls(form.filled);
      const changed = watchCalls(form.changed);
      const errorsChanged = watchCalls(form.errorsChanged);

      await scoped(appScope, async () => {
        await form.fill({});
        expect(filled).toEqual([{ a: "seed" }]);
        expect(changed).toEqual([{ a: "seed" }]);
        expect(errorsChanged).toEqual([{ a: null }]);
      });
    });

    it("does not emit outer errors on a values-only fill", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "" } });

      await scoped(appScope, async () => {
        await form.fill({ values: { name: "Ada" } });
        expect(readStoreSnapshot(form.outerErrors)).toEqual({ name: null });
      });
    });

    it("does not change values on an errors-only fill", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "seed" } });

      await scoped(appScope, async () => {
        await form.fill({ errors: { name: "bad" } });
        expect(readStoreSnapshot(form.values)).toEqual({ name: "seed" });
      });
    });

    it("fills nested and dotted-path errors", async () => {
      const appScope = scope();
      const form = createForm({ schema: { profile: { email: "", name: "" } } });

      await scoped(appScope, async () => {
        await form.fill({
          errors: {
            "profile.email": "Invalid email",
            profile: { name: "Name required" },
          } as any,
        });
        expect(readStoreSnapshot(form.errors)).toEqual({
          profile: { email: "Invalid email", name: "Name required" },
        });
      });
    });

    it("silently skips a values fill whose key is a dotted path, since values are not dot-expanded", async () => {
      const appScope = scope();
      const form = createForm({ schema: { profile: { email: "" } } });

      await scoped(appScope, async () => {
        // unlike the errors channel, fillSchemaFx does not expand dotted paths:
        // schema["profile.email"] is undefined → the key is dropped.
        await form.fill({ values: { "profile.email": "ada@x.com" } as any });
        expect(readStoreSnapshot(form.values)).toEqual({ profile: { email: "" } });
      });
    });

    it("silently drops a scalar error for a nested group key", async () => {
      const appScope = scope();
      const form = createForm({ schema: { profile: { email: "" } } });

      await scoped(appScope, async () => {
        await form.fill({ errors: { profile: "whole group bad" } as any });
        // silently dropped — the group keeps its cleared shape
        expect(readStoreSnapshot(form.outerErrors)).toEqual({
          profile: { email: null },
        });
      });
    });

    it("awaits validate at the end when the change strategy is set", async () => {
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
        await form.fill({ values: { name: "Ada" } });
        expect(readStoreSnapshot(form.errors)).toEqual({ name: null });
      });
    });
  });

  describe("reset", () => {
    it("restores values, errors and snapshot baseline and clears isChanged", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "", age: 0 } });

      await scoped(appScope, async () => {
        await form.fill({ values: { name: "Ada", age: 36 }, errors: { name: "Server" } });
        expect(form.isChanged.value).toBe(true);

        await form.reset();
        expect(readStoreSnapshot(form.values)).toEqual({ name: "", age: 0 });
        expect(readStoreSnapshot(form.errors)).toEqual({ name: null, age: null });
        expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "", age: 0 });
        expect(form.isChanged.value).toBe(false);
      });
    });

    it("emits changed and errorsChanged but not filled or validated", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: () => ({ name: "x" }),
      });
      const filled = watchCalls(form.filled);
      const changed = watchCalls(form.changed);
      const errorsChanged = watchCalls(form.errorsChanged);
      const validated = watchCalls(form.validated);

      await scoped(appScope, async () => {
        await form.reset();
        expect(filled).toEqual([]);
        expect(validated).toEqual([]);
        expect(changed).toHaveLength(1);
        expect(errorsChanged).toHaveLength(1);
      });
    });

    it("restores the original baseline even after persist moved it", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "orig" } });

      await scoped(appScope, async () => {
        await form.persist({ values: { name: "persisted" } });
        await form.reset();
        // reset uses the immutable initialSnapshot, not the persisted one
        expect(readStoreSnapshot(form.values)).toEqual({ name: "orig" });
        expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "orig" });
      });
    });
  });

  describe("snapshot mutations", () => {
    it("resolves error precedence and emits on each of clearOuterErrors then clearInnerErrors", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: (values: { name: string }) =>
          values.name ? null : { name: "Inner required" },
      });

      await scoped(appScope, async () => {
        await form.fill({ errors: { name: "Server required" } });
        await form.validate();
        expect(readStoreSnapshot(form.errors)).toEqual({ name: "Server required" });

        const errorsChanged = watchCalls(form.errorsChanged);
        await form.clearOuterErrors();
        expect(readStoreSnapshot(form.errors)).toEqual({ name: "Inner required" });
        await form.clearInnerErrors();
        expect(readStoreSnapshot(form.errors)).toEqual({ name: null });
        expect(errorsChanged).toHaveLength(2);
      });
    });

    it("clears isChanged and emits nothing on forceUpdateSnapshot", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "" } });
      const filled = watchCalls(form.filled);
      const changed = watchCalls(form.changed);
      const errorsChanged = watchCalls(form.errorsChanged);

      await scoped(appScope, async () => {
        await form.fields.name.fill("Ada");
        expect(form.isChanged.value).toBe(true);

        const before = filled.length + changed.length + errorsChanged.length;
        await form.forceUpdateSnapshot();
        expect(form.isChanged.value).toBe(false);
        // no additional events from forceUpdateSnapshot
        expect(filled.length + changed.length + errorsChanged.length).toBe(before);
      });
    });

    it("fills then makes the persisted state the new baseline with isChanged false", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "", age: 0 } });
      const filled = watchCalls(form.filled);

      await scoped(appScope, async () => {
        await form.persist({ values: { name: "Ada", age: 36 }, errors: { age: "Too young" } });
        expect(readStoreSnapshot(form.values)).toEqual({ name: "Ada", age: 36 });
        expect(readStoreSnapshot(form.errors)).toEqual({ name: null, age: "Too young" });
        expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "Ada", age: 36 });
        expect(form.isChanged.value).toBe(false);
        // persist goes through fill → emits filled
        expect(filled).toHaveLength(1);
      });
    });

    it("treats persist errors as optional", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "" } });

      await scoped(appScope, async () => {
        await form.persist({ values: { name: "Ada" } });
        expect(readStoreSnapshot(form.values)).toEqual({ name: "Ada" });
        expect(readStoreSnapshot(form.errors)).toEqual({ name: null });
        expect(form.isChanged.value).toBe(false);
      });
    });
  });

  describe("submit", () => {
    it("emits submitted before running validation", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: (values: { name: string }) =>
          values.name ? null : { name: "Required" },
      });
      const order: string[] = [];
      reaction({ on: form.submitted, run: () => order.push("submitted") });
      reaction({ on: form.validationFailed, run: () => order.push("validationFailed") });

      await scoped(appScope, async () => {
        await form.submit();
        expect(order).toEqual(["submitted", "validationFailed"]);
      });
    });

    it("on an invalid submit fires submitted, not validatedAndSubmitted, and leaves the snapshot unchanged", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: (values: { name: string }) =>
          values.name ? null : { name: "Required" },
      });
      const submitted = watchCalls(form.submitted);
      const validatedAndSubmitted = watchCalls(form.validatedAndSubmitted);

      await scoped(appScope, async () => {
        await form.persist({ values: { name: "Saved" } });
        await form.fill({ values: { name: "" } });
        await form.submit();

        expect(submitted).toHaveLength(1);
        expect(validatedAndSubmitted).toEqual([]);
        expect(form.isChanged.value).toBe(true);
        expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "Saved" });
      });
    });

    it("on a valid submit refreshes the snapshot and fires validatedAndSubmitted", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: (values: { name: string }) =>
          values.name ? null : { name: "Required" },
      });
      const validatedAndSubmitted = watchCalls(form.validatedAndSubmitted);

      await scoped(appScope, async () => {
        await form.fill({ values: { name: "Ada" } });
        await form.submit();
        expect(validatedAndSubmitted).toEqual([{ name: "Ada" }]);
        expect(form.isChanged.value).toBe(false);
        expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "Ada" });
      });
    });

    it("always validates even without any validation strategy", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation: (values: { name: string }) =>
          values.name ? null : { name: "Required" },
        // no validationStrategies
      });
      const failed = watchCalls(form.validationFailed);

      await scoped(appScope, async () => {
        await form.submit();
        expect(failed).toEqual([{ name: "" }]);
        expect(readStoreSnapshot(form.errors)).toEqual({ name: "Required" });
      });
    });

    it("emits validated on each validate and submit but validatedAndSubmitted only after a passing submit", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: "" },
        validation(values) {
          return values.name ? null : { name: "Required" };
        },
      });
      const submitted = watchCalls(form.submitted);
      const validated = watchCalls(form.validated);
      const failed = watchCalls(form.validationFailed);
      const validatedAndSubmitted = watchCalls(form.validatedAndSubmitted);

      await scoped(appScope, async () => {
        await form.submit();
        expect(submitted).toEqual([{ name: "" }]);
        expect(failed).toEqual([{ name: "" }]);
        expect(validatedAndSubmitted).toEqual([]);

        await form.fill({ values: { name: "Ada" } });
        expect(form.isChanged.value).toBe(true);

        await form.validate();
        expect(validatedAndSubmitted).toEqual([]);

        await form.submit();
        expect(validated).toEqual([{ name: "Ada" }, { name: "Ada" }]);
        expect(validatedAndSubmitted).toEqual([{ name: "Ada" }]);
        expect(form.isChanged.value).toBe(false);
        expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "Ada" });
      });
    });
  });

  describe("projection", () => {
    it("shares the same field instances so mutations are visible both ways", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          account: { email: createField(""), password: createField("") },
        },
      });
      const proj = form.pick({ account: { email: true } });

      expect(proj.fields.account.email).toBe(form.fields.account.email);

      await scoped(appScope, async () => {
        await proj.fill({ values: { account: { email: "ada@x.com" } } });
        expect(readStoreSnapshot(form.values).account.email).toBe("ada@x.com");

        await form.fields.account.email.fill("changed@x.com");
        expect(readStoreSnapshot(proj.values).account.email).toBe("changed@x.com");
      });
    });

    it("does not run a cross-field form validator on the projection", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { a: createField(""), b: createField("") },
        validation: () => ({ a: "form-level error" }),
      });
      const proj = form.pick({ a: true });

      await scoped(appScope, async () => {
        await proj.validate();
        // projection carries no form validators — a has no own validator → stays null
        expect(readStoreSnapshot(proj.errors)).toEqual({ a: null });

        // but the parent's validator DOES exist and fires on the parent
        await form.validate();
        expect(readStoreSnapshot(form.errors).a).toBe("form-level error");
      });
    });

    it("validates only the picked field's own validator and shares the write with the parent", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          account: {
            email: createField("", {
              validate: (value: string) => (value ? null : "Email required"),
            }),
            password: createField("", {
              validate: (value: string) => (value.length >= 8 ? null : "Password short"),
            }),
          },
        },
      });
      const accountEmail = form.pick({ account: { email: true } });

      await scoped(appScope, async () => {
        await accountEmail.validate();

        expect(readStoreSnapshot(accountEmail.errors)).toEqual({ account: { email: "Email required" } });
        expect(readStoreSnapshot(form.errors)).toEqual({
          account: { email: "Email required", password: null },
        });

        await accountEmail.fill({ values: { account: { email: "ada@example.com" } } });
        expect(readStoreSnapshot(form.values).account.email).toBe("ada@example.com");
      });
    });

    it("carries validationStrategies into the projection", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          name: createField("", {
            validate: (value: string) => (value ? null : "req"),
          }),
        },
        validationStrategies: ["change"],
      });
      const proj = form.pick({ name: true });

      await scoped(appScope, async () => {
        await proj.fill({ values: { name: "" } });
        // change strategy carried → child validator ran on the projection
        expect(readStoreSnapshot(proj.errors)).toEqual({ name: "req" });
      });
    });

    it("skips keys not present in the schema", async () => {
      const appScope = scope();
      const form = createForm({ schema: { a: "", b: "" } });
      const proj = form.pick({ a: true, zzz: true } as any);

      await scoped(appScope, async () => {
        expect(Object.keys(readStoreSnapshot(proj.values))).toEqual(["a"]);
      });
    });

    it("selects a whole group with true and recurses into it with an object", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { group: { x: "", y: "" }, leaf: "" },
      });
      const whole = form.pick({ group: true });
      const partial = form.pick({ group: { x: true } });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(whole.values)).toEqual({ group: { x: "", y: "" } });
        expect(readStoreSnapshot(partial.values)).toEqual({ group: { x: "" } });
      });
    });

    it("supports a deeply nested pick of three or more levels", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { a: { b: { c: "", d: "" } } },
      });
      const proj = form.pick({ a: { b: { c: true } } });

      expect(proj.fields.a.b.c).toBe(form.fields.a.b.c);
      expect((proj.fields.a.b as any).d).toBeUndefined();

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(proj.values)).toEqual({ a: { b: { c: "" } } });
      });
    });
  });

  describe("serialization", () => {
    it("serialize returns current values and effective errors, read returns values", async () => {
      const appScope = scope();
      const form = createForm({ schema: { name: "" } });

      await scoped(appScope, async () => {
        await form.fill({ values: { name: "Ada" }, errors: { name: "Server" } });
        expect(form.serialize()).toEqual({
          values: { name: "Ada" },
          errors: { name: "Server" },
        });
        expect(form.read()).toEqual({ name: "Ada" });
      });
    });
  });

  describe("validation pending", () => {
    it("is true while the form-level async validator is running", async () => {
      const appScope = scope();
      const gate = deferred<{ name: string } | null>();
      const form = createForm({
        schema: { name: "" },
        validation: () => gate.promise,
      });

      await scoped(appScope, async () => {
        const running = form.validate();
        await tick(5);
        expect(form.isValidationPending.value).toBe(true);
        gate.resolve(null);
        await running;
        expect(form.isValidationPending.value).toBe(false);
      });
    });

    it("is true while a child field's async validation is pending", async () => {
      const appScope = scope();
      const gate = deferred<string | null>();
      const nameField = createField("", { validate: () => gate.promise });
      const form = createForm({ schema: { name: nameField } });

      await scoped(appScope, async () => {
        const running = nameField.validate();
        await tick(3);
        expect(form.isValidationPending.value).toBe(true);
        gate.resolve(null);
        await running;
        expect(form.isValidationPending.value).toBe(false);
      });
    });
  });

  describe("change strategy", () => {
    it("triggers validate multiple times on a single fill but converges on the latest value", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { name: createField("") },
        validation: (values: { name: string }) =>
          values.name.length >= 3 ? null : { name: "too short" },
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        // one fill: per-field changed reaction + fillFx explicit validate both fire
        await form.fill({ values: { name: "ab" } });
        await scoped(() => tick(50));
        expect(readStoreSnapshot(form.errors)).toEqual({ name: "too short" });

        await form.fill({ values: { name: "abcd" } });
        await scoped(() => tick(50));
        // converges to the latest value's result, no stale error left behind
        expect(readStoreSnapshot(form.errors)).toEqual({ name: null });
      });
    });

    it("validates on change across multiple fields", async () => {
      const appScope = scope();
      const form = createForm({
        schema: { a: createField(""), b: createField("") },
        validation: (values: { a: string; b: string }) =>
          values.a === values.b ? null : { a: "mismatch" },
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await form.fill({ values: { a: "x" } });
        await scoped(() => tick(50));
        expect(readStoreSnapshot(form.errors).a).toBe("mismatch");

        await form.fill({ values: { b: "x" } });
        await scoped(() => tick(50));
        expect(readStoreSnapshot(form.errors).a).toBe(null);
      });
    });
  });

  describe("array fields", () => {
    it("keeps a createArrayField contract as one field and tracks its mutations", async () => {
      const appScope = scope();
      const form = createForm({ schema: { tags: createArrayField(["a", "b"]) } });

      // an array field is a field contract → kept as-is (kind "array"), not a group
      expect((form.fields.tags as any).kind).toBe("array");

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(form.values)).toEqual({ tags: ["a", "b"] });

        await form.fields.tags.push("c");
        expect(readStoreSnapshot(form.values)).toEqual({ tags: ["a", "b", "c"] });
        expect(form.isChanged.value).toBe(true);

        // per-item array errors flow through the form error channel
        await form.fill({ errors: { tags: [null, "bad", null] } as any });
        expect(readStoreSnapshot(form.errors)).toEqual({ tags: [null, "bad", null] });
      });
    });

    it("fills an array field's values and per-item errors through the form", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          tags: createArrayField(["a", "b"]),
        },
      });

      await scoped(appScope, async () => {
        await form.fill({ values: { tags: ["x", "y", "z"] } });
        expect(readStoreSnapshot(form.values)).toEqual({ tags: ["x", "y", "z"] });

        await form.fill({ errors: { tags: [null, "Bad tag", null] } });
        expect(readStoreSnapshot(form.errors)).toEqual({ tags: [null, "Bad tag", null] });
      });
    });

    it("marks isChanged on an array push and on an array replace, cleared in between by forceUpdateSnapshot", async () => {
      const appScope = scope();
      const form = createForm({
        schema: {
          name: "",
          tags: createArrayField<string>([]),
        },
      });

      await scoped(appScope, async () => {
        await form.fields.tags.push("typescript");
        expect(form.isChanged.value).toBe(true);

        await form.forceUpdateSnapshot();
        expect(form.isChanged.value).toBe(false);

        await form.fields.tags.replace(0, "virentia");
        expect(form.isChanged.value).toBe(true);
      });
    });
  });

  describe("custom field contract", () => {
    it("awaits a custom field's fill and reset before emitting form events", async () => {
      const appScope = scope();
      const valueBox = store(0);
      const order: string[] = [];
      const delayed = {
        kind: "delayed",
        state: computed(() => valueBox.value),
        async fill(next: number) {
          order.push("field.fill:start");
          await Promise.resolve();
          valueBox.value = next;
          order.push("field.fill:end");
        },
        async reset() {
          order.push("field.reset:start");
          await Promise.resolve();
          valueBox.value = 0;
          order.push("field.reset:end");
        },
        read() {
          return valueBox.value;
        },
      } satisfies FieldContract<number>;
      const form = createForm({ schema: { delayed } });
      const changed: { delayed: number }[] = [];

      reaction({
        on: form.changed,
        run(value) {
          order.push("form.changed");
          changed.push(value);
        },
      });

      await scoped(appScope, async () => {
        await form.fill({ values: { delayed: 42 } });
        expect(readStoreSnapshot(form.values)).toEqual({ delayed: 42 });
        expect(changed).toEqual([{ delayed: 42 }]);
        expect(order.slice(0, 3)).toEqual(["field.fill:start", "field.fill:end", "form.changed"]);

        await form.reset();
        expect(readStoreSnapshot(form.values)).toEqual({ delayed: 0 });
        expect(order).toEqual([
          "field.fill:start",
          "field.fill:end",
          "form.changed",
          "field.reset:start",
          "field.reset:end",
          "form.changed",
        ]);
      });
    });
  });

  describe("scope isolation", () => {
    it("keeps values isolated between Virentia scopes", async () => {
      const firstScope = scope();
      const secondScope = scope();
      const form = createForm({ schema: { name: "" } });

      await scoped(firstScope, async () => {
        await form.fill({ values: { name: "First" } });
      });
      await scoped(secondScope, async () => {
        await form.fill({ values: { name: "Second" } });
      });

      await scoped(firstScope, async () => {
        expect(readStoreSnapshot(form.values)).toEqual({ name: "First" });
      });
      await scoped(secondScope, async () => {
        expect(readStoreSnapshot(form.values)).toEqual({ name: "Second" });
      });
    });

    it("does not leak the active scope after a dependency-driven revalidation", async () => {
      const appScope = scope();
      const minAge = store(18);
      const form = createForm({
        schema: { age: 16 },
        validation: (values: { age: number }, ctx: ValidationContext) =>
          values.age >= ctx.read(minAge) ? null : { age: "Too young" },
      });

      await scoped(appScope, async () => {
        await form.validate();
        minAge.value = 16;
        await scoped(() => tick(100));
      });

      // The detached dependency-tracker reaction must not have leaked appScope into
      // the ambient global.
      expect(getCurrentScope()).toBe(null);
    });
  });
});
