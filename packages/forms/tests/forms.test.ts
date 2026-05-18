import { describe, expect, it } from "vitest";
import { computed, effect, scope, scoped, store } from "@virentia/core";
import {
  createArrayField,
  createField,
  createForm,
  createShapeField,
  createWizard,
  fieldType,
  readStoreSnapshot,
  step,
  type FieldContract,
  type ValidationContext,
  type ValidationPayload,
} from "../lib";

describe("@virentia/forms", () => {
  it("creates primitive fields with awaitable lifecycle and validation", async () => {
    const appScope = scope();
    const name = createField<string>("", {
      validate: (value: string) => (value.trim() ? null : "Name is required"),
    });

    await scoped(appScope, async () => {
      await name.validate();
      expect(name.error.value).toBe("Name is required");
      expect(name.isValid.value).toBe(false);

      await name.fill("Ada");
      await name.validate();

      expect(name.state.value).toBe("Ada");
      expect(name.error.value).toBe(null);

      await name.setOuterErrors("Server says no");
      expect(name.error.value).toBe("Server says no");

      await name.clearOuterErrors();
      expect(name.error.value).toBe(null);
    });
  });

  it("composes forms and waits for custom field fill/reset", async () => {
    const appScope = scope();
    const valueBox = store({ value: 0 });
    const delayed = {
      kind: "delayed",
      state: computed(() => valueBox.value),
      async fill(next: number) {
        await Promise.resolve();
        valueBox.value = next;
      },
      async reset() {
        await Promise.resolve();
        valueBox.value = 0;
      },
      read() {
        return valueBox.value;
      },
    } satisfies FieldContract<number>;

    const form = createForm({
      schema: {
        name: createField<string>("", {
          validate: (value: string) => (value.length >= 2 ? null : "Too short"),
        }),
        delayed,
      },
      validation(values: { name: string }) {
        return values.name === "root" ? { name: "Reserved" } : null;
      },
    });

    await scoped(appScope, async () => {
      await form.fill({ values: { name: "A", delayed: 42 } });

      expect(form.values.name).toBe("A");
      expect(form.values.delayed).toBe(42);

      await form.validate();
      expect(form.errors.name).toBe("Too short");

      await form.fill({ values: { name: "root" } });
      await form.validate();
      expect(form.errors.name).toBe("Reserved");

      await form.reset();
      expect(readStoreSnapshot(form.values)).toEqual({ name: "", delayed: 0 });
    });
  });

  it("supports dynamic shape fields", async () => {
    const appScope = scope();
    const attributes = createShapeField({
      title: createField("Hello"),
    });
    const form = createForm({ schema: { attributes } });

    await scoped(appScope, async () => {
      expect(form.values.attributes).toEqual({ title: "Hello" });

      await attributes.add({
        key: "slug",
        field: createField("", {
          validate: (value: string) => (value.trim() ? null : "Slug is required"),
        }),
      });
      await form.fill({ values: { attributes: { slug: "hello-world" } } as any });

      expect(form.values.attributes).toEqual({ title: "Hello", slug: "hello-world" });

      await attributes.remove("title");
      expect(form.values.attributes).toEqual({ slug: "hello-world" });
    });
  });

  it("supports array fields with item-level validation and operations", async () => {
    const appScope = scope();
    const tags = createArrayField(["one"], {
      createItem(value) {
        return createField(value, {
          validate: (next: string) => (next.trim() ? null : "Tag is required"),
        });
      },
    });

    await scoped(appScope, async () => {
      await tags.push("two");
      expect(readStoreSnapshot(tags.state)).toEqual(["one", "two"]);

      await tags.replace(1, "");
      await tags.validate();

      expect(readStoreSnapshot(tags.errors)).toEqual([null, "Tag is required"]);

      await tags.swap(0, 1);
      expect(readStoreSnapshot(tags.state)).toEqual(["", "one"]);
    });
  });

  it("revalidates when a validator reads another Virentia store", async () => {
    const appScope = scope();
    const forbidden = store("taken");
    const username = createField("taken", {
      validate(value: string, ctx: ValidationContext) {
        return value === ctx.read(forbidden) ? "Already taken" : null;
      },
    });

    await scoped(appScope, async () => {
      await username.validate();
      expect(username.error.value).toBe("Already taken");

      forbidden.value = "free";
      await Promise.resolve();
      await Promise.resolve();

      expect(username.error.value).toBe(null);
    });
  });

  it("accepts Virentia effects as validators", async () => {
    const appScope = scope();
    const forbidden = store("taken");
    const validateUsername = effect<ValidationPayload<string>, string | null>(
      (payload: ValidationPayload<string>) =>
        payload.value === payload.ctx.read(forbidden) ? "Already taken" : null,
    );
    const username = createField("taken", {
      validate: validateUsername,
    });

    await scoped(appScope, async () => {
      await username.validate();
      expect(username.error.value).toBe("Already taken");
    });
  });

  it("builds reusable field types with extend", async () => {
    const appScope = scope();
    const primitive = fieldType({
      create: createField,
    });
    const trimmed = primitive.extend({
      create(base, initial: string) {
        const field = base(initial);

        return {
          ...field,
          kind: "trimmed",
          async normalize() {
            await field.fill(field.read().trim());
          },
        };
      },
    });
    const title = trimmed("  Virentia  ");

    await scoped(appScope, async () => {
      await (title as typeof title & { normalize(): Promise<void> }).normalize();
      expect(title.state.value).toBe("Virentia");
    });
  });

  it("treats wizard steps as forms and validates current step before navigation", async () => {
    const appScope = scope();
    const signup = createForm({
      schema: {
        email: createField<string>("", {
          validate: (value: string) => (value.trim() ? null : "Email is required"),
        }),
        password: createField<string>("", {
          validate: (value: string) => (value.length >= 8 ? null : "Password is too short"),
        }),
        billingEmail: createField<string>(""),
        plan: createField<"free" | "team">("free"),
      },
    });
    const wizard = createWizard({
      form: signup,
      steps: [
        step("account", {
          form: signup.pick({ email: true, password: true }),
        }),
        step("billing", {
          form: signup.pick({ billingEmail: true }),
          when: ({ values }) => (values as { plan: "free" | "team" }).plan === "team",
        }),
      ],
    });

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(wizard.currentId)).toBe("account");
      expect(await wizard.next()).toBe(false);
      expect(readStoreSnapshot(wizard.currentId)).toBe("account");

      await signup.fill({ values: { email: "ada@example.com", password: "supersecret" } });
      expect(await wizard.next()).toBe(false);

      await signup.fill({ values: { plan: "team" } });
      expect(await wizard.next()).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("billing");

      expect(await wizard.complete()).toBe(true);
      expect(readStoreSnapshot(wizard.completedIds)).toEqual(["account", "billing"]);
    });
  });
});
