import { describe, expect, it } from "vitest";
import { scope, scoped } from "@virentia/core";
import { createField, createShapeField, readStoreSnapshot } from "../lib";
import { watchCalls } from "./_helpers";

describe("createShapeField", () => {
  it("reads child values and errors", async () => {
    const appScope = scope();
    const shape = createShapeField({
      title: createField("Hello"),
      slug: createField("hello"),
    });

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hello", slug: "hello" });

      await shape.setOuterErrors({ title: "Server title" } as any);
      expect(readStoreSnapshot(shape.errors)).toEqual({ title: "Server title", slug: null });
      expect(shape.serialize?.()).toEqual({
        value: { title: "Hello", slug: "hello" },
        errors: { title: "Server title", slug: null },
      });
    });
  });

  it("adds, removes, replaces and clears fields", async () => {
    const appScope = scope();
    const shape = createShapeField({
      title: createField("Hello"),
    });
    const changed = watchCalls(shape.changed);

    await scoped(appScope, async () => {
      await shape.add({ key: "slug", field: createField("hello") });
      expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hello", slug: "hello" });

      await shape.replace({ key: "title", field: createField("Hi") });
      expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hi", slug: "hello" });

      await shape.remove("slug");
      expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hi" });

      await shape.remove("missing");
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

  it("fills existing fields and creates missing fields through createField", async () => {
    const appScope = scope();
    const created: string[] = [];
    const shape = createShapeField(
      {
        title: "Hello",
      },
      {
        createField(key, value) {
          created.push(`${key}:${String(value)}`);
          return createField(value);
        },
      },
    );

    await scoped(appScope, async () => {
      await shape.fill({ title: "Hi", slug: "hello-world" } as any);

      expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hi", slug: "hello-world" });
      expect(created).toEqual(["title:Hello", "slug:hello-world"]);
    });
  });

  it("resets to the initial field set and removes dynamic fields", async () => {
    const appScope = scope();
    const initialTitle = createField("Hello");
    const shape = createShapeField({
      title: initialTitle,
    });

    await scoped(appScope, async () => {
      await shape.add({ key: "slug", field: createField("hello") });
      await shape.fill({ title: "Hi", slug: "changed" } as any);
      await shape.setOuterErrors({ title: "Server" } as any);

      await shape.reset();

      expect(shape.readFields()).toEqual({ title: initialTitle });
      expect(readStoreSnapshot(shape.state)).toEqual({ title: "Hello" });
      expect(readStoreSnapshot(shape.errors)).toEqual({ title: null });
    });
  });

  it("sets and clears nested child errors", async () => {
    const appScope = scope();
    const shape = createShapeField({
      nested: createShapeField({
        title: createField("Hello"),
      }),
      slug: createField("hello"),
    });

    await scoped(appScope, async () => {
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

  it("validates child fields and shape validator together", async () => {
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
      expect(readStoreSnapshot(shape.errors)).toEqual({
        title: "Title is required",
        slug: "Slug is reserved",
      });

      await shape.fill({ title: "Hello", slug: "hello" });
      await shape.validate();
      expect(readStoreSnapshot(shape.errors)).toEqual({ title: null, slug: null });
    });
  });

  it("supports validation on change for dynamic shape fields", async () => {
    const appScope = scope();
    const shape = createShapeField(
      {
        slug: "",
      },
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
});
