import { describe, expect, it } from "vitest";
import { getCurrentScope, scope, scoped } from "@virentia/core";
import { createField, createForm, createWizard, createWizardForm, readStoreSnapshot, step } from "../lib";
import { watchCalls } from "./_helpers";

// Factory helpers (create OUTSIDE a scope; mutate INSIDE scoped()).
const plainForm = (key: string) => createForm({ schema: { [key]: "" } });
const requiredForm = (key: string, message = `${key} required`) =>
  createForm({
    schema: {
      [key]: createField("", { validate: (value: string) => (value ? null : message) }),
    },
  });
const alwaysInvalidForm = (key: string, message = `${key} invalid`) =>
  createForm({
    schema: {
      [key]: createField("", { validate: () => message }),
    },
  });

describe("step", () => {
  it("merges the id with every config field", () => {
    const form = plainForm("a");
    const when = ({ values }: { values: unknown }) => Boolean(values);
    const result = step("a", { form, title: "Account", when });

    expect(result).toEqual({ id: "a", form, title: "Account", when });
    expect(result.id).toBe("a");
    expect(result.form).toBe(form);
    expect(result.title).toBe("Account");
    expect(result.when).toBe(when);
  });

  it("places the id ahead of the config spread", () => {
    // The implementation is `{ id, ...config }`, so a config.id would override the arg.
    const form = plainForm("a");
    const result = step("a", { form } as never);
    expect(result.id).toBe("a");
  });

  it("accepts the { pick } config shape", () => {
    const result = step("a", { pick: { email: true } });
    expect(result).toEqual({ id: "a", pick: { email: true } });
  });
});

describe("createWizard", () => {
  describe("construction", () => {
    it("throws when steps is empty", () => {
      expect(() => createWizard({ steps: [] })).toThrow("Wizard requires at least one step");
    });

    it("starts on the first step, visited but not completed", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.currentId)).toBe("a");
        expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["a"]);
        expect(readStoreSnapshot(wizard.completedIds)).toEqual([]);
        expect(readStoreSnapshot(wizard.currentIndex)).toBe(0);
        expect(wizard.kind).toBe("wizard");
      });
    });

    it("exposes the root form on .form", () => {
      const root = plainForm("x");
      const rooted = createWizard({ form: root, steps: [step("a", { form: root.pick({ x: true }) })] });
      expect(rooted.form).toBe(root);
    });

    it("leaves .form undefined when there is no root form", () => {
      const standalone = createWizard({ steps: [step("a", { form: plainForm("x") })] });
      expect(standalone.form).toBeUndefined();
    });

    it("currentStep is the whole active step object including its title", async () => {
      const appScope = scope();
      const formA = plainForm("a");
      const wizard = createWizard({
        steps: [step("a", { form: formA, title: "Account" }), step("b", { form: plainForm("b") })],
      });

      await scoped(appScope, async () => {
        const current = readStoreSnapshot(wizard.currentStep);
        expect(current.id).toBe("a");
        expect(current.title).toBe("Account");
      });
    });

    it("currentForm is the active step's form", async () => {
      const appScope = scope();
      const formA = plainForm("a");
      const wizard = createWizard({
        steps: [step("a", { form: formA, title: "Account" }), step("b", { form: plainForm("b") })],
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.currentForm)).toBe(formA);
      });
    });

    it("steps store carries every configured step", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.steps).map((s) => s.id)).toEqual(["a", "b"]);
      });
    });

    it("visibleSteps equals steps when no step declares a when", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.visibleSteps).map((s) => s.id)).toEqual(["a", "b"]);
      });
    });
  });

  describe("visible steps", () => {
    it("excludes a conditional step until its when passes", async () => {
      const appScope = scope();
      const root = createForm({ schema: { plan: createField<"free" | "team">("free"), a: "", b: "" } });
      const wizard = createWizard({
        form: root,
        steps: [
          step("a", { form: root.pick({ a: true }) }),
          step("b", {
            form: root.pick({ b: true }),
            when: ({ values }) => (values as { plan: string }).plan === "team",
          }),
        ],
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.visibleSteps).map((s) => s.id)).toEqual(["a"]);
        await root.fill({ values: { plan: "team" } });
        expect(readStoreSnapshot(wizard.visibleSteps).map((s) => s.id)).toEqual(["a", "b"]);
      });
    });

    it("passes the root form values to a step's when", async () => {
      const appScope = scope();
      const root = createForm({ schema: { plan: "team", a: "", b: "" } });
      let seen: unknown = "unset";
      const wizard = createWizard({
        form: root,
        steps: [
          step("a", { form: root.pick({ a: true }) }),
          step("b", {
            form: root.pick({ b: true }),
            when: ({ values }) => {
              seen = values;
              return true;
            },
          }),
        ],
      });

      await scoped(appScope, async () => {
        readStoreSnapshot(wizard.visibleSteps);
        expect(seen).toEqual({ plan: "team", a: "", b: "" });
      });
    });

    it("passes undefined values to a step's when without a root form", async () => {
      const appScope = scope();
      let seen: unknown = "unset";
      const wizard = createWizard({
        steps: [
          step("a", { form: plainForm("a") }),
          step("b", {
            form: plainForm("b"),
            when: ({ values }) => {
              seen = values;
              return values != null;
            },
          }),
        ],
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.visibleSteps).map((s) => s.id)).toEqual(["a"]);
        expect(seen).toBeUndefined();
      });
    });

    it("falls back to the first step at index -1 when every step is hidden", async () => {
      const appScope = scope();
      const only = plainForm("only");
      const wizard = createWizard({ steps: [step("only", { form: only, when: () => false })] });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.visibleSteps)).toEqual([]);
        // currentStep = visible.find(...) ?? visible[0] ?? steps[0]
        expect(readStoreSnapshot(wizard.currentStep).id).toBe("only");
        expect(readStoreSnapshot(wizard.currentId)).toBe("only");
        expect(readStoreSnapshot(wizard.currentIndex)).toBe(-1);
        expect(readStoreSnapshot(wizard.canGoBack)).toBe(false);
        expect(readStoreSnapshot(wizard.canGoNext)).toBe(false);
      });
    });
  });

  describe("canGoBack and canGoNext", () => {
    it("canGoBack is false at the first step, then true after advancing", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.canGoBack)).toBe(false);
        expect(await wizard.next()).toBe(true);
        expect(readStoreSnapshot(wizard.canGoBack)).toBe(true);
        expect(await wizard.back()).toBe(true);
        expect(readStoreSnapshot(wizard.canGoBack)).toBe(false);
      });
    });

    it("canGoNext is true until the last step, then false", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.canGoNext)).toBe(true);
        await wizard.next();
        expect(readStoreSnapshot(wizard.canGoNext)).toBe(false);
      });
    });
  });

  describe("next()", () => {
    it("returns false and stays on an invalid current step", async () => {
      const appScope = scope();
      const account = requiredForm("email", "Email required");
      const wizard = createWizard({
        steps: [step("account", { form: account }), step("profile", { form: plainForm("name") })],
      });

      await scoped(appScope, async () => {
        expect(await wizard.next()).toBe(false);
        expect(readStoreSnapshot(wizard.currentId)).toBe("account");
        expect(readStoreSnapshot(wizard.completedIds)).toEqual([]);
        expect(readStoreSnapshot(account.errors)).toEqual({ email: "Email required" });
      });
    });

    it("advances and marks the current step completed when it is valid", async () => {
      const appScope = scope();
      const account = requiredForm("email", "Email required");
      const wizard = createWizard({
        steps: [step("account", { form: account }), step("profile", { form: plainForm("name") })],
      });

      await scoped(appScope, async () => {
        await account.fill({ values: { email: "ada@example.com" } });
        expect(await wizard.next()).toBe(true);
        expect(readStoreSnapshot(wizard.currentId)).toBe("profile");
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["account"]);
        expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["account", "profile"]);
      });
    });

    it("returns false at the last step without validating it", async () => {
      const appScope = scope();
      const first = plainForm("first");
      const second = alwaysInvalidForm("second", "Second invalid");
      const wizard = createWizard({
        steps: [step("first", { form: first }), step("second", { form: second })],
      });

      await scoped(appScope, async () => {
        expect(await wizard.next()).toBe(true); // first is valid
        expect(readStoreSnapshot(wizard.currentId)).toBe("second");
        // At the last step, next() short-circuits before validateStep -> second stays unvalidated.
        expect(await wizard.next()).toBe(false);
        expect(readStoreSnapshot(second.errors)).toEqual({ second: null });
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["first"]);
      });
    });
  });

  describe("back()", () => {
    it("returns false at the first step and does not emit changed", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
      });
      const changed = watchCalls(wizard.changed);

      await scoped(appScope, async () => {
        expect(await wizard.back()).toBe(false);
        expect(readStoreSnapshot(wizard.currentId)).toBe("a");
      });
      expect(changed).toEqual([]);
    });

    it("goes back without validating the current step", async () => {
      const appScope = scope();
      const first = plainForm("first");
      const second = alwaysInvalidForm("second", "Second invalid");
      const wizard = createWizard({
        steps: [step("first", { form: first }), step("second", { form: second })],
      });

      await scoped(appScope, async () => {
        expect(await wizard.next()).toBe(true);
        expect(await wizard.back()).toBe(true);
        expect(readStoreSnapshot(wizard.currentId)).toBe("first");
        expect(readStoreSnapshot(second.errors)).toEqual({ second: null });
      });
    });
  });

  describe("goTo()", () => {
    it("returns false for an unknown id and leaves state unchanged", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
      });
      const changed = watchCalls(wizard.changed);

      await scoped(appScope, async () => {
        expect(await wizard.goTo("nope" as never)).toBe(false);
        expect(readStoreSnapshot(wizard.currentId)).toBe("a");
        expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["a"]);
      });
      expect(changed).toEqual([]);
    });

    it("returns false for a hidden id", async () => {
      const appScope = scope();
      const root = createForm({ schema: { plan: "free", a: "", b: "" } });
      const wizard = createWizard({
        form: root,
        steps: [
          step("a", { form: root.pick({ a: true }) }),
          step("b", { form: root.pick({ b: true }), when: ({ values }) => (values as { plan: string }).plan === "team" }),
        ],
      });

      await scoped(appScope, async () => {
        expect(await wizard.goTo("b")).toBe(false);
        expect(readStoreSnapshot(wizard.currentId)).toBe("a");
      });
    });

    it("validates each intermediate step in order and stops at the first invalid", async () => {
      const appScope = scope();
      const first = plainForm("first");
      const second = requiredForm("second", "Second required");
      const third = plainForm("third");
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
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["first"]);

        await second.fill({ values: { second: "ok" } });
        expect(await wizard.goTo("third")).toBe(true);
        expect(readStoreSnapshot(wizard.currentId)).toBe("third");
        // forward marks the intermediates completed but NOT the target.
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["first", "second"]);
      });
    });

    it("validates steps before the target but not the target itself", async () => {
      const appScope = scope();
      const s1 = plainForm("s1");
      const s2 = alwaysInvalidForm("s2", "S2 invalid");
      const s3 = plainForm("s3");
      const wizard = createWizard({
        steps: [step("s1", { form: s1 }), step("s2", { form: s2 }), step("s3", { form: s3 })],
      });

      await scoped(appScope, async () => {
        // goTo("s2"): validates only s1 (before target), not s2 itself.
        expect(await wizard.goTo("s2")).toBe(true);
        expect(readStoreSnapshot(wizard.currentId)).toBe("s2");
        expect(readStoreSnapshot(s2.errors)).toEqual({ s2: null });
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["s1"]);
      });
    });

    it("skips validation entirely when moving backward", async () => {
      const appScope = scope();
      const s1 = plainForm("s1");
      const s2 = alwaysInvalidForm("s2", "S2 invalid");
      const s3 = plainForm("s3");
      const wizard = createWizard({
        steps: [step("s1", { form: s1 }), step("s2", { form: s2 }), step("s3", { form: s3 })],
      });

      await scoped(appScope, async () => {
        await wizard.goTo("s2");
        // backward goTo("s1"): no validation, succeeds even though s2 is invalid.
        expect(await wizard.goTo("s1")).toBe(true);
        expect(readStoreSnapshot(wizard.currentId)).toBe("s1");
        expect(readStoreSnapshot(s2.errors)).toEqual({ s2: null });
      });
    });

    it("re-selecting the current step skips validation, returns true and re-emits changed", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [step("a", { form: alwaysInvalidForm("a") }), step("b", { form: plainForm("b") })],
      });
      const changed = watchCalls(wizard.changed);

      await scoped(appScope, async () => {
        expect(await wizard.goTo("a")).toBe(true);
        expect(readStoreSnapshot(wizard.currentId)).toBe("a");
      });
      expect(changed).toEqual(["a"]);
    });

    it("returns false when the current step itself is invalid", async () => {
      const appScope = scope();
      const s1 = alwaysInvalidForm("s1", "S1 invalid");
      const s2 = plainForm("s2");
      const s3 = plainForm("s3");
      const wizard = createWizard({
        steps: [step("s1", { form: s1 }), step("s2", { form: s2 }), step("s3", { form: s3 })],
      });
      const changed = watchCalls(wizard.changed);

      await scoped(appScope, async () => {
        // goToFx loops `for (index = currentIndex; index < target)`, so it validates s1 first.
        expect(await wizard.goTo("s3")).toBe(false);
        expect(readStoreSnapshot(wizard.currentId)).toBe("s1");
        expect(readStoreSnapshot(wizard.completedIds)).toEqual([]);
        expect(readStoreSnapshot(s1.errors)).toEqual({ s1: "S1 invalid" });
      });
      expect(changed).toEqual([]);
    });
  });

  describe("complete()", () => {
    it("moves to the first invalid visible step and does not emit completed", async () => {
      const appScope = scope();
      const first = plainForm("first");
      const second = requiredForm("second", "Second required");
      const wizard = createWizard({
        steps: [step("first", { form: first }), step("second", { form: second })],
      });
      const completed = watchCalls(wizard.completed);

      await scoped(appScope, async () => {
        expect(await wizard.complete()).toBe(false);
        expect(readStoreSnapshot(wizard.currentId)).toBe("second");
        // first was validated + marked before hitting the invalid second.
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["first"]);
      });
      expect(completed).toEqual([]);
    });

    it("marks every visible step completed and emits completed when all are valid", async () => {
      const appScope = scope();
      const first = plainForm("first");
      const second = requiredForm("second", "Second required");
      const wizard = createWizard({
        steps: [step("first", { form: first }), step("second", { form: second })],
      });
      const completed = watchCalls(wizard.completed);

      await scoped(appScope, async () => {
        await second.fill({ values: { second: "ok" } });
        expect(await wizard.complete()).toBe(true);
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["first", "second"]);
      });
      expect(completed).toEqual([{ first: { first: "" }, second: { second: "ok" } }]);
    });

    it("does not let a hidden invalid step block completion", async () => {
      const appScope = scope();
      const root = createForm({
        schema: {
          plan: "free",
          a: "",
          b: createField("", { validate: () => "B always invalid" }),
          c: "",
        },
      });
      const wizard = createWizard({
        form: root,
        steps: [
          step("a", { form: root.pick({ a: true }) }),
          step("b", { form: root.pick({ b: true }), when: ({ values }) => (values as { plan: string }).plan === "team" }),
          step("c", { form: root.pick({ c: true }) }),
        ],
      });
      const completed = watchCalls(wizard.completed);

      await scoped(appScope, async () => {
        // plan=free -> b hidden. Only a and c are validated (both valid).
        expect(await wizard.complete()).toBe(true);
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["a", "c"]);
      });
      expect(completed.length).toBe(1);
    });

    it("runs zero validations, returns true and emits completed when every step is hidden", async () => {
      const appScope = scope();
      const only = plainForm("only");
      const wizard = createWizard({ steps: [step("only", { form: only, when: () => false })] });
      const completed = watchCalls(wizard.completed);

      await scoped(appScope, async () => {
        await only.fill({ values: { only: "z" } });
        expect(await wizard.complete()).toBe(true);
        expect(readStoreSnapshot(wizard.completedIds)).toEqual([]);
      });
      // read() for standalone keys by every step id (hidden included).
      expect(completed).toEqual([{ only: { only: "z" } }]);
    });

    it("emits completed with the whole root form values, not per-step keys", async () => {
      const appScope = scope();
      const root = createForm({ schema: { email: "", name: "" } });
      const wizard = createWizard({
        form: root,
        steps: [step("a", { form: root.pick({ email: true }) }), step("b", { form: root.pick({ name: true }) })],
      });
      const completed = watchCalls(wizard.completed);

      await scoped(appScope, async () => {
        await root.fill({ values: { email: "e", name: "n" } });
        expect(await wizard.complete()).toBe(true);
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["a", "b"]);
      });
      // rooted read() returns the flat root values, not { a: ..., b: ... }.
      expect(completed).toEqual([{ email: "e", name: "n" }]);
    });
  });

  describe("completedIds", () => {
    it("does not append a duplicate when re-completing an already-completed step", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
      });

      await scoped(appScope, async () => {
        expect(await wizard.next()).toBe(true); // marks a
        expect(await wizard.back()).toBe(true);
        expect(await wizard.next()).toBe(true); // marks a again -> still unique
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["a"]);
      });
    });

    it("stays unique across two completes while re-emitting completed each time", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
      });
      const completed = watchCalls(wizard.completed);

      await scoped(appScope, async () => {
        expect(await wizard.complete()).toBe(true);
        expect(await wizard.complete()).toBe(true);
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["a", "b"]);
      });
      expect(completed).toEqual([
        { a: { a: "" }, b: { b: "" } },
        { a: { a: "" }, b: { b: "" } },
      ]);
    });
  });

  describe("reset()", () => {
    it("restores the root form and navigation state, emitting changed(first)", async () => {
      const appScope = scope();
      const root = createForm({ schema: { email: "" } });
      const wizard = createWizard({
        form: root,
        steps: [step("account", { form: root.pick({ email: true }) }), step("confirm", { form: root.pick({ email: true }) })],
      });
      const changed = watchCalls(wizard.changed);

      await scoped(appScope, async () => {
        await root.fill({ values: { email: "ada@example.com" } });
        await wizard.next();
        await wizard.reset();

        expect(readStoreSnapshot(root.values)).toEqual({ email: "" });
        expect(readStoreSnapshot(wizard.currentId)).toBe("account");
        expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["account"]);
        expect(readStoreSnapshot(wizard.completedIds)).toEqual([]);
      });
      // next -> changed("confirm"); reset -> changed("account")
      expect(changed).toEqual(["confirm", "account"]);
    });

    it("resets every step form when there is no root form", async () => {
      const appScope = scope();
      const first = plainForm("first");
      const second = plainForm("second");
      const wizard = createWizard({
        steps: [step("first", { form: first }), step("second", { form: second })],
      });

      await scoped(appScope, async () => {
        await first.fill({ values: { first: "A" } });
        await second.fill({ values: { second: "B" } });
        await wizard.next();
        expect(readStoreSnapshot(wizard.currentId)).toBe("second");

        await wizard.reset();

        expect(readStoreSnapshot(first.values)).toEqual({ first: "" });
        expect(readStoreSnapshot(second.values)).toEqual({ second: "" });
        expect(readStoreSnapshot(wizard.currentId)).toBe("first");
        expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["first"]);
        expect(readStoreSnapshot(wizard.completedIds)).toEqual([]);
      });
    });
  });

  describe("read()", () => {
    it("returns the root form values when a root form exists", async () => {
      const appScope = scope();
      const root = createForm({ schema: { email: "", name: "" } });
      const wizard = createWizard({
        form: root,
        steps: [step("a", { form: root.pick({ email: true }) })],
      });

      await scoped(appScope, async () => {
        await root.fill({ values: { email: "ada@example.com", name: "Ada" } });
        expect(wizard.read()).toEqual({ email: "ada@example.com", name: "Ada" });
      });
    });

    it("returns a map keyed by step id, including hidden steps, when standalone", async () => {
      const appScope = scope();
      const first = plainForm("first");
      const second = plainForm("second");
      const hidden = plainForm("hidden");
      const wizard = createWizard({
        steps: [
          step("first", { form: first }),
          step("second", { form: second }),
          step("hidden", { form: hidden, when: () => false }),
        ],
      });

      await scoped(appScope, async () => {
        await first.fill({ values: { first: "A" } });
        await second.fill({ values: { second: "B" } });
        expect(wizard.read()).toEqual({
          first: { first: "A" },
          second: { second: "B" },
          hidden: { hidden: "" },
        });
      });
    });
  });

  describe("events", () => {
    it("emits changed on every navigation and on reset", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [
          step("a", { form: plainForm("a") }),
          step("b", { form: plainForm("b") }),
          step("c", { form: plainForm("c") }),
        ],
      });
      const changed = watchCalls(wizard.changed);

      await scoped(appScope, async () => {
        await wizard.next(); // -> b
        await wizard.next(); // -> c
        await wizard.back(); // -> b
        await wizard.goTo("a"); // -> a
        await wizard.reset(); // -> a
      });
      expect(changed).toEqual(["b", "c", "b", "a", "a"]);
    });

    it("accumulates visitedIds uniquely in first-visit order across back and forward", async () => {
      const appScope = scope();
      const wizard = createWizard({
        steps: [
          step("a", { form: plainForm("a") }),
          step("b", { form: plainForm("b") }),
          step("c", { form: plainForm("c") }),
        ],
      });

      await scoped(appScope, async () => {
        await wizard.next(); // a,b
        await wizard.next(); // a,b,c
        await wizard.back(); // still a,b,c (b already visited)
        await wizard.goTo("a"); // still a,b,c
        expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["a", "b", "c"]);
      });
    });

    it("emits completed only on a successful complete", async () => {
      const appScope = scope();
      const first = requiredForm("first", "First required");
      const wizard = createWizard({ steps: [step("first", { form: first })] });
      const completed = watchCalls(wizard.completed);

      await scoped(appScope, async () => {
        expect(await wizard.complete()).toBe(false);
        expect(completed).toEqual([]);
        await first.fill({ values: { first: "x" } });
        expect(await wizard.complete()).toBe(true);
      });
      expect(completed).toEqual([{ first: { first: "x" } }]);
    });
  });

  describe("when the current step becomes hidden", () => {
    it("falls back to the first visible step, jumping past nearer ones", async () => {
      const appScope = scope();
      const root = createForm({ schema: { plan: createField<"free" | "team">("team"), a: "", b: "", c: "" } });
      const wizard = createWizard({
        form: root,
        steps: [
          step("a", { form: root.pick({ a: true }) }),
          step("b", { form: root.pick({ b: true }), when: ({ values }) => (values as { plan: string }).plan === "team" }),
          step("c", { form: root.pick({ c: true }) }),
        ],
      });

      await scoped(appScope, async () => {
        expect(await wizard.goTo("b")).toBe(true);
        expect(readStoreSnapshot(wizard.currentId)).toBe("b");

        // Hide the current step "b".
        await root.fill({ values: { plan: "free" } });

        // currentStep = visible.find(b)=undefined ?? visible[0]("a"). Silent jump to "a".
        expect(readStoreSnapshot(wizard.visibleSteps).map((s) => s.id)).toEqual(["a", "c"]);
        expect(readStoreSnapshot(wizard.currentId)).toBe("a");
        expect(readStoreSnapshot(wizard.currentIndex)).toBe(0);
      });
    });

    it("snaps back to the step once it becomes visible again", async () => {
      // currentStep falls back visually, but currentIdBox is never rewritten, so when
      // the step becomes visible again currentId silently snaps back to it.
      const appScope = scope();
      const root = createForm({ schema: { plan: createField<"free" | "team">("team"), a: "", b: "", c: "" } });
      const wizard = createWizard({
        form: root,
        steps: [
          step("a", { form: root.pick({ a: true }) }),
          step("b", { form: root.pick({ b: true }), when: ({ values }) => (values as { plan: string }).plan === "team" }),
          step("c", { form: root.pick({ c: true }) }),
        ],
      });

      await scoped(appScope, async () => {
        await wizard.goTo("b");
        await root.fill({ values: { plan: "free" } });
        expect(readStoreSnapshot(wizard.currentId)).toBe("a"); // visual fallback
        await root.fill({ values: { plan: "team" } });
        expect(readStoreSnapshot(wizard.currentId)).toBe("b"); // stale box resurfaces
      });
    });

    it("keeps the current step when it stays visible while other steps hide", async () => {
      const appScope = scope();
      const root = createForm({ schema: { plan: createField<"free" | "team">("team"), a: "", b: "", c: "" } });
      const wizard = createWizard({
        form: root,
        steps: [
          step("a", { form: root.pick({ a: true }) }),
          step("b", { form: root.pick({ b: true }), when: ({ values }) => (values as { plan: string }).plan === "team" }),
          step("c", { form: root.pick({ c: true }) }),
        ],
      });

      await scoped(appScope, async () => {
        expect(await wizard.goTo("c")).toBe(true); // needs b valid (plainForm ok)
        expect(readStoreSnapshot(wizard.currentId)).toBe("c");
        await root.fill({ values: { plan: "free" } }); // hides b, not c
        expect(readStoreSnapshot(wizard.currentId)).toBe("c");
        // c was at index 2; visible now [a, c] so index 1.
        expect(readStoreSnapshot(wizard.currentIndex)).toBe(1);
      });
    });
  });

  describe("scope", () => {
    it("navigation state is isolated per scope on a single wizard instance", async () => {
      const scopeA = scope();
      const scopeB = scope();
      const wizard = createWizard({
        steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
      });

      await scoped(scopeA, async () => {
        expect(await wizard.next()).toBe(true);
        expect(readStoreSnapshot(wizard.currentId)).toBe("b");
      });

      await scoped(scopeB, async () => {
        // scopeB has its own store state — untouched by scopeA's advance.
        expect(readStoreSnapshot(wizard.currentId)).toBe("a");
        expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["a"]);
      });
    });

    it("preserves the ambient scope across awaited navigation effects", async () => {
      const appScope = scope();
      const account = requiredForm("email", "Email required");
      const wizard = createWizard({
        steps: [step("account", { form: account }), step("profile", { form: plainForm("name") })],
      });

      await scoped(appScope, async () => {
        expect(getCurrentScope()).toBe(appScope);
        // Invalid path (validation runs, blocks) — scope must survive.
        expect(await wizard.next()).toBe(false);
        expect(getCurrentScope()).toBe(appScope);

        await account.fill({ values: { email: "ada@example.com" } });
        expect(await wizard.next()).toBe(true);
        expect(getCurrentScope()).toBe(appScope);

        // A subsequent unrelated validation still binds to THIS scope.
        await account.validate();
        expect(readStoreSnapshot(account.errors)).toEqual({ email: null });
        expect(getCurrentScope()).toBe(appScope);
      });
    });
  });

  describe("navigation over hidden steps", () => {
    it("next advances to the next visible step, skipping a hidden intermediate", async () => {
      const appScope = scope();
      // b is hidden while plan=free; nextFx operates on visibleSteps, so a -> c.
      const root = createForm({ schema: { plan: "free", a: "", b: "", c: "" } });
      const wizard = createWizard({
        form: root,
        steps: [
          step("a", { form: root.pick({ a: true }) }),
          step("b", { form: root.pick({ b: true }), when: ({ values }) => (values as { plan: string }).plan === "team" }),
          step("c", { form: root.pick({ c: true }) }),
        ],
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.visibleSteps).map((s) => s.id)).toEqual(["a", "c"]);
        expect(await wizard.next()).toBe(true);
        expect(readStoreSnapshot(wizard.currentId)).toBe("c");
        expect(readStoreSnapshot(wizard.completedIds)).toEqual(["a"]);
        expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["a", "c"]);
      });
    });

    it("back returns to the previous visible step, skipping a hidden intermediate", async () => {
      const appScope = scope();
      const root = createForm({ schema: { plan: "free", a: "", b: "", c: "" } });
      const wizard = createWizard({
        form: root,
        steps: [
          step("a", { form: root.pick({ a: true }) }),
          step("b", { form: root.pick({ b: true }), when: ({ values }) => (values as { plan: string }).plan === "team" }),
          step("c", { form: root.pick({ c: true }) }),
        ],
      });

      await scoped(appScope, async () => {
        expect(await wizard.next()).toBe(true); // a -> c (b hidden)
        expect(readStoreSnapshot(wizard.currentId)).toBe("c");
        expect(await wizard.back()).toBe(true); // c -> a (b hidden)
        expect(readStoreSnapshot(wizard.currentId)).toBe("a");
      });
    });

    it("next, back and goTo all return false when every step is hidden", async () => {
      const appScope = scope();
      const only = plainForm("only");
      const wizard = createWizard({ steps: [step("only", { form: only, when: () => false })] });
      const changed = watchCalls(wizard.changed);

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.currentIndex)).toBe(-1);
        expect(await wizard.next()).toBe(false);
        expect(await wizard.back()).toBe(false);
        expect(await wizard.goTo("only")).toBe(false); // hidden -> not found in visibleSteps
        expect(readStoreSnapshot(wizard.currentId)).toBe("only");
      });
      expect(changed).toEqual([]);
    });
  });

  describe("duplicate step ids", () => {
    it("resolve to the first match, so next cannot leave the first of two same-id steps", async () => {
      const appScope = scope();
      const first = plainForm("first");
      const second = plainForm("second");
      // Degenerate config: both steps carry id "dup".
      const wizard = createWizard({
        steps: [step("dup", { form: first } as never), step("dup", { form: second } as never)],
      });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(wizard.currentIndex)).toBe(0);
        expect(readStoreSnapshot(wizard.currentForm)).toBe(first);
        // next() sets currentIdBox to "dup" (the 2nd step's id), but currentStep still
        // resolves to the first match, so currentIndex stays 0 and currentForm stays `first`.
        expect(await wizard.next()).toBe(true);
        expect(readStoreSnapshot(wizard.currentId)).toBe("dup");
        expect(readStoreSnapshot(wizard.currentIndex)).toBe(0);
        expect(readStoreSnapshot(wizard.currentForm)).toBe(first);
        // visited collapses to a single "dup" entry (appendUnique).
        expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["dup"]);
      });
    });
  });
});

describe("createWizardForm", () => {
  it("builds a root form and wizard together from a steps function", async () => {
    const appScope = scope();
    const wizard = createWizardForm({
      schema: {
        email: createField("", { validate: (v: string) => (v ? null : "Email required") }),
        name: "",
      },
      steps: (form) => [
        step("account", { form: form.pick({ email: true }) }),
        step("profile", { form: form.pick({ name: true }) }),
      ],
    });

    await scoped(appScope, async () => {
      expect(wizard.kind).toBe("wizard");
      expect(wizard.form.kind).toBe("form");
      expect(await wizard.next()).toBe(false);
      await wizard.form.fill({ values: { email: "ada@example.com" } });
      expect(await wizard.next()).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("profile");
    });
  });

  it("resolves pick, form-object and form-true step variants", async () => {
    const appScope = scope();
    const wizard = createWizardForm({
      schema: {
        email: createField("", { validate: (v: string) => (v ? null : "Email required") }),
        name: createField("", { validate: (v: string) => (v ? null : "Name required") }),
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
      expect(readStoreSnapshot(wizard.form.errors)).toEqual({ email: null, name: "Name required" });

      await wizard.form.fill({ values: { name: "Ada" } });
      expect(await wizard.next()).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("review"); // form: true -> whole root form
      expect(await wizard.complete()).toBe(true);
    });
  });

  it("passes a form-like step through unchanged", async () => {
    const appScope = scope();
    const external = createForm({ schema: { note: "" } });
    const wizard = createWizardForm({
      schema: { email: "" },
      steps: [step("account", { form: { email: true } }), step("extra", { form: external } as never)],
    });

    await scoped(appScope, async () => {
      const steps = readStoreSnapshot(wizard.steps);
      const extra = steps.find((s) => s.id === "extra");
      expect(extra?.form).toBe(external);
    });
  });

  it("throws when a form step has neither a valid form nor a pick", () => {
    expect(() =>
      createWizardForm({
        schema: { email: "" },
        steps: [{ id: "bad", form: 123 as never }],
      }),
    ).toThrow("Wizard form step requires a form or pick");
  });

  it("read returns the root form values", async () => {
    const appScope = scope();
    const wizard = createWizardForm({
      schema: { email: "", name: "" },
      steps: [step("a", { pick: { email: true } }), step("b", { pick: { name: true } })],
    });

    await scoped(appScope, async () => {
      await wizard.form.fill({ values: { email: "e", name: "n" } });
      expect(wizard.read()).toEqual({ email: "e", name: "n" });
    });
  });
});
