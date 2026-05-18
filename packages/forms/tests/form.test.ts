import { describe, expect, it } from "vitest";
import { computed, reaction, scope, scoped, store } from "@virentia/core";
import {
  createArrayField,
  createField,
  createForm,
  readStoreSnapshot,
  type FieldContract,
} from "../lib";
import { watchCalls } from "./_helpers";

describe("createForm", () => {
  it("fills partial primitive and nested values", async () => {
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

  it("fills array values and array errors inside a form", async () => {
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

  it("applies nested and dotted-path errors", async () => {
    const appScope = scope();
    const form = createForm({
      schema: {
        profile: {
          email: "",
          name: "",
        },
      },
    });

    await scoped(appScope, async () => {
      await form.fill({
        errors: {
          "profile.email": "Invalid email",
          profile: { name: "Name is required" },
        } as any,
      });

      expect(readStoreSnapshot(form.errors)).toEqual({
        profile: { email: "Invalid email", name: "Name is required" },
      });
    });
  });

  it("emits filled, changed and errorsChanged once per fill", async () => {
    const appScope = scope();
    const form = createForm({ schema: { a: "", b: 0 } });
    const filled = watchCalls(form.filled);
    const changed = watchCalls(form.changed);
    const errorsChanged = watchCalls(form.errorsChanged);

    await scoped(appScope, async () => {
      await form.fill({ values: { a: "x", b: 1 }, errors: { b: "Bad number" } });

      expect(filled).toEqual([{ a: "x", b: 1 }]);
      expect(changed).toEqual([{ a: "x", b: 1 }]);
      expect(errorsChanged).toEqual([{ a: null, b: "Bad number" }]);
    });
  });

  it("waits custom field fill and reset before emitting form events", async () => {
    const appScope = scope();
    const valueBox = store({ value: 0 });
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

  it("resets values, errors and snapshot baseline", async () => {
    const appScope = scope();
    const form = createForm({ schema: { name: "", age: 0 } });

    await scoped(appScope, async () => {
      expect(form.isChanged.value).toBe(false);

      await form.fill({ values: { name: "Ada", age: 36 }, errors: { name: "Server" } });
      expect(form.isChanged.value).toBe(true);

      await form.reset();
      expect(readStoreSnapshot(form.values)).toEqual({ name: "", age: 0 });
      expect(readStoreSnapshot(form.errors)).toEqual({ name: null, age: null });
      expect(form.isChanged.value).toBe(false);
      expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "", age: 0 });
    });
  });

  it("persists values and errors and updates snapshot", async () => {
    const appScope = scope();
    const form = createForm({ schema: { name: "", age: 0 } });

    await scoped(appScope, async () => {
      await form.persist({ values: { name: "Ada", age: 36 }, errors: { age: "Too young" } });

      expect(readStoreSnapshot(form.values)).toEqual({ name: "Ada", age: 36 });
      expect(readStoreSnapshot(form.errors)).toEqual({ name: null, age: "Too young" });
      expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "Ada", age: 36 });
      expect(form.isChanged.value).toBe(false);
    });
  });

  it("validates child fields and form-level validators", async () => {
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

  it("clears stale inner errors but preserves outer errors during validation", async () => {
    const appScope = scope();
    const form = createForm({
      schema: { name: "" },
      validation(values) {
        return values.name ? null : { name: "Inner required" };
      },
    });

    await scoped(appScope, async () => {
      await form.fill({ errors: { name: "Server required" } });
      await form.validate();
      expect(readStoreSnapshot(form.errors)).toEqual({ name: "Server required" });

      await form.clearOuterErrors();
      expect(readStoreSnapshot(form.errors)).toEqual({ name: "Inner required" });

      await form.clearInnerErrors();
      expect(readStoreSnapshot(form.errors)).toEqual({ name: null });
    });
  });

  it("emits submit lifecycle and updates snapshot only after successful submit", async () => {
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

  it("does not update snapshot after failed submit", async () => {
    const appScope = scope();
    const form = createForm({
      schema: { name: "" },
      validation(values) {
        return values.name ? null : { name: "Required" };
      },
    });

    await scoped(appScope, async () => {
      await form.persist({ values: { name: "Saved" } });
      await form.fill({ values: { name: "" } });
      await form.submit();

      expect(form.isChanged.value).toBe(true);
      expect(readStoreSnapshot(form.snapshot)).toEqual({ name: "Saved" });
    });
  });

  it("validates on change when configured", async () => {
    const appScope = scope();
    const form = createForm({
      schema: { name: "" },
      validation(values) {
        return values.name ? null : { name: "Required" };
      },
      validationStrategies: ["change"],
    });

    await scoped(appScope, async () => {
      await form.fill({ values: { name: "" } });
      expect(readStoreSnapshot(form.errors)).toEqual({ name: "Required" });

      await form.fill({ values: { name: "Ada" } });
      expect(readStoreSnapshot(form.errors)).toEqual({ name: null });
    });
  });

  it("creates projections that share selected fields and validate only selected schema", async () => {
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

  it("tracks isChanged for direct subfield and array mutations", async () => {
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

  it("serializes current values and effective errors", async () => {
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
