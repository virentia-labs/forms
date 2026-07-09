import { describe, expect, it } from "vitest";
import {
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
  type ValidationContext,
  type ValidationPayload,
} from "../lib";
import { deferred, tick, watchCalls } from "./_helpers";

describe("createForm — schema normalization", () => {
  it("keeps a field contract as-is", async () => {
    const appScope = scope();
    const name = createField("seed");
    const form = createForm({ schema: { name } });

    expect(form.fields.name).toBe(name);

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(form.values)).toEqual({ name: "seed" });
    });
  });

  it("turns a plain object into a nested group recursively (arbitrary depth)", async () => {
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

  it("wraps an array value as ONE field, not a group", async () => {
    const appScope = scope();
    const form = createForm({ schema: { tags: [] as string[] } });

    expect((form.fields.tags as any).kind).toBe("field");
    expect(typeof form.fields.tags.fill).toBe("function");

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(form.values)).toEqual({ tags: [] });
    });
  });

  it("wraps a Date value as ONE field, not a group", async () => {
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
});

describe("createForm — stores & aliases", () => {
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

  it("snapshot equals the initial values before any change", async () => {
    const appScope = scope();
    const form = createForm({ schema: { name: "seed", age: 7 } });

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "seed", age: 7 });
      expect(form.isChanged.value).toBe(false);
    });
  });

  it("isChanged tracks deep inequality between values and snapshot", async () => {
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

  it("isValid reflects hasErrors over the merged errors", async () => {
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

  it("innerErrors, outerErrors and errors diverge by channel (outer wins in errors)", async () => {
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
});

describe("createForm — validate lifecycle", () => {
  it("emits errorsChanged exactly twice per successful run (clear then apply)", async () => {
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

  it("routes form-validator errors to the INNER channel and leaves outer untouched", async () => {
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

  it("applies only the FIRST failing form validator's errors (array)", async () => {
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

  it("skips passing validators and applies the first that returns errors (array)", async () => {
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

  it("accepts a single Virentia effect as form validation", async () => {
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

  it("validate never touches outer errors", async () => {
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

  it("FLAG G-2: form-validator error overwrites the field's own inner error", async () => {
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

  it("child validators AND form validators combine across keys", async () => {
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
});

describe("createForm — dependency tracking", () => {
  it("revalidates when a tracked store changes and does not leak scope", async () => {
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

    // The detached dependency-tracker reaction must not have leaked appScope into
    // the ambient global.
    expect(getCurrentScope()).toBe(null);
  });

  it("empty dependencies install no reaction (unread store never triggers revalidation)", async () => {
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

  it("replaces the scope-bound reaction each run (revalidation still fires after multiple validates)", async () => {
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

describe("createForm — fill", () => {
  it("fills only present keys, skips unknown keys", async () => {
    const appScope = scope();
    const form = createForm({ schema: { a: "", b: 0 } });

    await scoped(appScope, async () => {
      await form.fill({ values: { a: "x", zzz: "ignored" } as any });
      expect(readStoreSnapshot(form.values)).toEqual({ a: "x", b: 0 });
    });
  });

  it("routes fill errors to the OUTER channel", async () => {
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

  it("empty fill still emits filled/changed/errorsChanged with current state", async () => {
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

  it("values-only fill does not emit outer errors", async () => {
    const appScope = scope();
    const form = createForm({ schema: { name: "" } });

    await scoped(appScope, async () => {
      await form.fill({ values: { name: "Ada" } });
      expect(readStoreSnapshot(form.outerErrors)).toEqual({ name: null });
    });
  });

  it("errors-only fill does not change values", async () => {
    const appScope = scope();
    const form = createForm({ schema: { name: "seed" } });

    await scoped(appScope, async () => {
      await form.fill({ errors: { name: "bad" } });
      expect(readStoreSnapshot(form.values)).toEqual({ name: "seed" });
    });
  });

  it("fills nested and dotted-path values/errors", async () => {
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

  it("FLAG G-11: a scalar error for a nested GROUP key is silently dropped", async () => {
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
});

describe("createForm — reset", () => {
  it("resets values, errors and snapshot baseline and clears isChanged", async () => {
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

  it("emits changed and errorsChanged but NOT filled or validated", async () => {
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

  it("reset restores the ORIGINAL baseline even after persist moved it", async () => {
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

describe("createForm — snapshot mutations", () => {
  it("clearOuterErrors and clearInnerErrors each emit errorsChanged", async () => {
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

  it("forceUpdateSnapshot clears isChanged and emits nothing", async () => {
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

  it("persist fills then makes the persisted state the new baseline (isChanged false)", async () => {
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

  it("persist errors are optional", async () => {
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

describe("createForm — submit lifecycle", () => {
  it("FLAG G-13: emits submitted BEFORE running validation", async () => {
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

  it("on invalid submit: submitted fires, validatedAndSubmitted does not, snapshot unchanged", async () => {
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

  it("on valid submit: forceUpdateSnapshot runs and validatedAndSubmitted fires", async () => {
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

  it("submit always validates even without any validation strategy", async () => {
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
});

describe("createForm — pick projection", () => {
  it("shares the SAME field instances (mutation visible both ways)", async () => {
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

  it("FLAG G-3: a cross-field form validator does NOT run on the projection", async () => {
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

  it("pickSchema skips keys not present in the schema", async () => {
    const appScope = scope();
    const form = createForm({ schema: { a: "", b: "" } });
    const proj = form.pick({ a: true, zzz: true } as any);

    await scoped(appScope, async () => {
      expect(Object.keys(readStoreSnapshot(proj.values))).toEqual(["a"]);
    });
  });

  it("true selects a whole group; an object recurses into it", async () => {
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

  it("supports deeply nested (>=3 level) pick", async () => {
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

describe("createForm — serialize / read", () => {
  it("serialize returns current values and effective errors", async () => {
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

describe("createForm — isValidationPending", () => {
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

  it("is true while a child field's async validation is pending (schemaIsPending)", async () => {
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

describe("createForm — change strategy", () => {
  it("FLAG G-5: a single fill triggers validate multiple times but converges (cancel-previous)", async () => {
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

describe("createForm — Date isChanged", () => {
  it("marks isChanged when a Date field's value changes (deepEqual compares by instant)", async () => {
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

describe("createForm — scope isolation", () => {
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
});

describe("createForm — degenerate & wild inputs", () => {
  it("accepts an empty schema (no keys, always valid, never changed)", async () => {
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

  it("keeps a createArrayField contract as ONE field and tracks array mutations", async () => {
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

  it("fill VALUES with a dotted-path key is silently skipped (values are NOT dot-expanded)", async () => {
    const appScope = scope();
    const form = createForm({ schema: { profile: { email: "" } } });

    await scoped(appScope, async () => {
      // unlike the errors channel, fillSchemaFx does not expand dotted paths:
      // schema["profile.email"] is undefined → the key is dropped.
      await form.fill({ values: { "profile.email": "ada@x.com" } as any });
      expect(readStoreSnapshot(form.values)).toEqual({ profile: { email: "" } });
    });
  });

  it("an empty-string error value still counts as an error (isValid false)", async () => {
    const appScope = scope();
    const form = createForm({ schema: { name: "" } });

    await scoped(appScope, async () => {
      await form.fill({ errors: { name: "" } });
      // hasErrors treats any non-null/undefined scalar (incl. "") as an error
      expect(readStoreSnapshot(form.errors)).toEqual({ name: "" });
      expect(form.isValid.value).toBe(false);
    });
  });
});

describe("createForm — validation as array of effects", () => {
  it("applies the first FAILING effect and skips a passing earlier one", async () => {
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
});

describe("createForm — FLAG G-11 (form validator scalar for group key)", () => {
  it("drops a scalar error a form validator returns for a nested GROUP key and deems the form VALID", async () => {
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
