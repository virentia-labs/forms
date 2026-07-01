import { describe, expect, it } from "vitest";
import { scope, scoped } from "@virentia/core";
import { createField, createForm, createWizard, createWizardForm, readStoreSnapshot, step } from "../lib";
import { watchCalls } from "./_helpers";

describe("createWizard", () => {
  it("requires at least one step", () => {
    expect(() => createWizard({ steps: [] })).toThrow("Wizard requires at least one step");
  });

  it("treats every step as a form and validates current step before next", async () => {
    const appScope = scope();
    const account = createForm({
      schema: {
        email: createField("", {
          validate: (value: string) => (value ? null : "Email required"),
        }),
      },
    });
    const profile = createForm({ schema: { name: "" } });
    const wizard = createWizard({
      steps: [
        step("account", { form: account }),
        step("profile", { form: profile }),
      ],
    });

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(wizard.currentId)).toBe("account");
      expect(await wizard.next()).toBe(false);
      expect(readStoreSnapshot(wizard.currentId)).toBe("account");
      expect(readStoreSnapshot(account.errors)).toEqual({ email: "Email required" });

      await account.fill({ values: { email: "ada@example.com" } });
      expect(await wizard.next()).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("profile");
      expect(readStoreSnapshot(wizard.completedIds)).toEqual(["account"]);
      expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["account", "profile"]);
    });
  });

  it("goes back without validating the current step", async () => {
    const appScope = scope();
    const first = createForm({ schema: { first: "" } });
    const second = createForm({
      schema: {
        second: createField("", {
          validate: () => "Second invalid",
        }),
      },
    });
    const wizard = createWizard({
      steps: [
        step("first", { form: first }),
        step("second", { form: second }),
      ],
    });

    await scoped(appScope, async () => {
      expect(await wizard.next()).toBe(true);
      expect(await wizard.back()).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("first");
      expect(readStoreSnapshot(second.errors)).toEqual({ second: null });
    });
  });

  it("validates intermediate steps when jumping forward", async () => {
    const appScope = scope();
    const first = createForm({ schema: { first: "" } });
    const second = createForm({
      schema: {
        second: createField("", {
          validate: (value: string) => (value ? null : "Second required"),
        }),
      },
    });
    const third = createForm({ schema: { third: "" } });
    const wizard = createWizard({
      steps: [
        step("first", { form: first }),
        step("second", { form: second }),
        step("third", { form: third }),
      ],
    });

    await scoped(appScope, async () => {
      expect(await wizard.goTo("third")).toBe(false);
      expect(readStoreSnapshot(wizard.currentId)).toBe("first");
      expect(readStoreSnapshot(second.errors)).toEqual({ second: "Second required" });

      await second.fill({ values: { second: "ok" } });
      expect(await wizard.goTo("third")).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("third");
      expect(readStoreSnapshot(wizard.completedIds)).toEqual(["first", "second"]);
    });
  });

  it("filters conditional steps from the root form values", async () => {
    const appScope = scope();
    const signup = createForm({
      schema: {
        plan: createField<"free" | "team">("free"),
        email: "",
        billingEmail: "",
      },
    });
    const wizard = createWizard({
      form: signup,
      steps: [
        step("account", { form: signup.pick({ email: true }) }),
        step("billing", {
          form: signup.pick({ billingEmail: true }),
          when: ({ values }) => (values as { plan: "free" | "team" }).plan === "team",
        }),
      ],
    });

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(wizard.visibleSteps).map((item) => item.id)).toEqual(["account"]);
      expect(readStoreSnapshot(wizard.canGoNext)).toBe(false);

      await signup.fill({ values: { plan: "team" } });
      expect(readStoreSnapshot(wizard.visibleSteps).map((item) => item.id)).toEqual(["account", "billing"]);
      expect(readStoreSnapshot(wizard.canGoNext)).toBe(true);
    });
  });

  it("complete validates every visible step and moves to the first invalid step", async () => {
    const appScope = scope();
    const first = createForm({ schema: { first: "" } });
    const second = createForm({
      schema: {
        second: createField("", {
          validate: (value: string) => (value ? null : "Second required"),
        }),
      },
    });
    const wizard = createWizard({
      steps: [
        step("first", { form: first }),
        step("second", { form: second }),
      ],
    });
    const completed = watchCalls(wizard.completed);

    await scoped(appScope, async () => {
      expect(await wizard.complete()).toBe(false);
      expect(readStoreSnapshot(wizard.currentId)).toBe("second");
      expect(completed).toEqual([]);

      await second.fill({ values: { second: "ok" } });
      expect(await wizard.complete()).toBe(true);
      expect(readStoreSnapshot(wizard.completedIds)).toEqual(["first", "second"]);
      expect(completed).toEqual([{ first: { first: "" }, second: { second: "ok" } }]);
    });
  });

  it("resets root form and navigation state", async () => {
    const appScope = scope();
    const form = createForm({ schema: { email: "" } });
    const wizard = createWizard({
      form,
      steps: [
        step("account", { form: form.pick({ email: true }) }),
        step("confirm", { form: form.pick({ email: true }) }),
      ],
    });

    await scoped(appScope, async () => {
      await form.fill({ values: { email: "ada@example.com" } });
      await wizard.next();

      await wizard.reset();

      expect(readStoreSnapshot(form.values)).toEqual({ email: "" });
      expect(readStoreSnapshot(wizard.currentId)).toBe("account");
      expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["account"]);
      expect(readStoreSnapshot(wizard.completedIds)).toEqual([]);
    });
  });

  it("reads local forms by step id when no root form exists", async () => {
    const appScope = scope();
    const first = createForm({ schema: { first: "" } });
    const second = createForm({ schema: { second: "" } });
    const wizard = createWizard({
      steps: [
        step("first", { form: first }),
        step("second", { form: second }),
      ],
    });

    await scoped(appScope, async () => {
      await first.fill({ values: { first: "A" } });
      await second.fill({ values: { second: "B" } });

      expect(wizard.read()).toEqual({
        first: { first: "A" },
        second: { second: "B" },
      });
    });
  });

  it("creates a root form and wizard together", async () => {
    const appScope = scope();
    const wizard = createWizardForm({
      schema: {
        email: createField("", {
          validate: (value: string) => (value ? null : "Email required"),
        }),
        name: "",
      },
      steps: (form) => [
        step("account", { form: form.pick({ email: true }) }),
        step("profile", { form: form.pick({ name: true }) }),
      ],
    });

    await scoped(appScope, async () => {
      expect(await wizard.next()).toBe(false);
      await wizard.form.fill({ values: { email: "ada@example.com" } });
      expect(await wizard.next()).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("profile");
    });
  });

  it("creates wizard form steps from the whole form or pick selections", async () => {
    const appScope = scope();
    const wizard = createWizardForm({
      schema: {
        email: createField("", {
          validate: (value: string) => (value ? null : "Email required"),
        }),
        name: createField("", {
          validate: (value: string) => (value ? null : "Name required"),
        }),
      },
      steps: [
        step("account", { pick: { email: true } }),
        step("profile", { form: { name: true } }),
        step("review", { form: true }),
      ],
    });

    await scoped(appScope, async () => {
      expect(await wizard.next()).toBe(false);
      expect(readStoreSnapshot(wizard.form.errors)).toEqual({ email: "Email required", name: null });

      await wizard.form.fill({ values: { email: "ada@example.com" } });
      expect(await wizard.next()).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("profile");

      expect(await wizard.next()).toBe(false);
      expect(readStoreSnapshot(wizard.form.errors)).toEqual({
        email: null,
        name: "Name required",
      });

      await wizard.form.fill({ values: { name: "Ada" } });
      expect(await wizard.next()).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("review");
      expect(await wizard.complete()).toBe(true);
    });
  });
});
