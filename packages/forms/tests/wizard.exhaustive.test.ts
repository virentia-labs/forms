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

// ---------------------------------------------------------------------------
// step()
// ---------------------------------------------------------------------------
describe("step()", () => {
  it("returns { id, ...config } spreading every config field", () => {
    const form = plainForm("a");
    const when = ({ values }: { values: unknown }) => Boolean(values);
    const result = step("a", { form, title: "Account", when });

    expect(result).toEqual({ id: "a", form, title: "Account", when });
    expect(result.id).toBe("a");
    expect(result.form).toBe(form);
    expect(result.title).toBe("Account");
    expect(result.when).toBe(when);
  });

  it("id overrides a colliding id key in config position (id comes first, spread wins)", () => {
    // The implementation is `{ id, ...config }`, so a config.id would override the arg.
    const form = plainForm("a");
    const result = step("a", { form } as never);
    expect(result.id).toBe("a");
  });

  it("supports the createWizardForm { pick } config shape", () => {
    const result = step("a", { pick: { email: true } });
    expect(result).toEqual({ id: "a", pick: { email: true } });
  });
});

// ---------------------------------------------------------------------------
// createWizard construction / initial state
// ---------------------------------------------------------------------------
describe("createWizard construction", () => {
  it("throws when steps is empty", () => {
    expect(() => createWizard({ steps: [] })).toThrow("Wizard requires at least one step");
  });

  it("initial currentId is the first step, visitedIds=[first], completedIds=[]", async () => {
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

  it("exposes the root form on .form (and undefined when standalone)", async () => {
    const root = plainForm("x");
    const rooted = createWizard({ form: root, steps: [step("a", { form: root.pick({ x: true }) })] });
    const standalone = createWizard({ steps: [step("a", { form: plainForm("x") })] });
    expect(rooted.form).toBe(root);
    expect(standalone.form).toBeUndefined();
  });

  it("currentStep returns the whole step object incl. title; currentForm the form", async () => {
    const appScope = scope();
    const formA = plainForm("a");
    const wizard = createWizard({
      steps: [step("a", { form: formA, title: "Account" }), step("b", { form: plainForm("b") })],
    });

    await scoped(appScope, async () => {
      const current = readStoreSnapshot(wizard.currentStep);
      expect(current.id).toBe("a");
      expect(current.title).toBe("Account");
      expect(readStoreSnapshot(wizard.currentForm)).toBe(formA);
    });
  });

  it("steps store carries all steps; visibleSteps === steps when no `when`", async () => {
    const appScope = scope();
    const wizard = createWizard({
      steps: [step("a", { form: plainForm("a") }), step("b", { form: plainForm("b") })],
    });

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(wizard.steps).map((s) => s.id)).toEqual(["a", "b"]);
      expect(readStoreSnapshot(wizard.visibleSteps).map((s) => s.id)).toEqual(["a", "b"]);
    });
  });
});

// ---------------------------------------------------------------------------
// visibleSteps / when()
// ---------------------------------------------------------------------------
describe("visibleSteps and when()", () => {
  it("filters steps whose when returns false, keeps steps with no when", async () => {
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

  it("when receives { values: form.read() } when a root form exists", async () => {
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

  it("FLAG G-15: standalone wizard passes { values: undefined } to when", async () => {
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

  it("all-steps-hidden: visibleSteps empty, currentStep falls back to steps[0], index -1", async () => {
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

// ---------------------------------------------------------------------------
// canGoBack / canGoNext
// ---------------------------------------------------------------------------
describe("canGoBack / canGoNext", () => {
  it("canGoBack is false at the first step and true after advancing (UNTESTED FR)", async () => {
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

// ---------------------------------------------------------------------------
// next()
// ---------------------------------------------------------------------------
describe("next()", () => {
  it("blocks and returns false when current is invalid; advances + completes when valid", async () => {
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

      await account.fill({ values: { email: "ada@example.com" } });
      expect(await wizard.next()).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("profile");
      expect(readStoreSnapshot(wizard.completedIds)).toEqual(["account"]);
      expect(readStoreSnapshot(wizard.visitedIds)).toEqual(["account", "profile"]);
    });
  });

  it("returns false at the last step WITHOUT validating it", async () => {
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

// ---------------------------------------------------------------------------
// back()
// ---------------------------------------------------------------------------
describe("back()", () => {
  it("returns false at the first step (UNTESTED FR) and does not emit changed", async () => {
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

  it("goes back WITHOUT validating the current step", async () => {
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

// ---------------------------------------------------------------------------
// goTo()
// ---------------------------------------------------------------------------
describe("goTo()", () => {
  it("returns false for a nonexistent id and leaves state unchanged (UNTESTED FR)", async () => {
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

  it("returns false for a hidden (not-visible) id", async () => {
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

  it("forward validates each intermediate in order and stops at the first invalid", async () => {
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

  it("forward does not validate the TARGET; backward skips validation entirely (UNTESTED FR)", async () => {
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

      // backward goTo("s1"): no validation, succeeds even though s2 is invalid.
      expect(await wizard.goTo("s1")).toBe(true);
      expect(readStoreSnapshot(wizard.currentId)).toBe("s1");
      expect(readStoreSnapshot(s2.errors)).toEqual({ s2: null });
    });
  });

  it("goTo current step (equal index) skips validation, returns true, re-emits changed", async () => {
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
});

// ---------------------------------------------------------------------------
// complete()
// ---------------------------------------------------------------------------
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

  it("on all-valid marks every visible step completed and emits completed(read())", async () => {
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

  it("ignores hidden steps: a hidden invalid step does not block completion", async () => {
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

  it("all-hidden wizard: complete() runs zero validations, returns true, emits completed(read())", async () => {
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
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------
describe("reset()", () => {
  it("resets the root form and navigation state; emits changed(first)", async () => {
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

  it("resets EVERY step form when there is no root form (UNTESTED FR)", async () => {
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

// ---------------------------------------------------------------------------
// read()
// ---------------------------------------------------------------------------
describe("read()", () => {
  it("returns root form.read() when a root form exists", async () => {
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

  it("returns { [stepId]: form.read() } for standalone, including hidden steps", async () => {
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

// ---------------------------------------------------------------------------
// events: changed on every setCurrentFx + reset; completed only on success
// ---------------------------------------------------------------------------
describe("events", () => {
  it("emits changed on every setCurrent (next/back/goTo) and on reset", async () => {
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

  it("visitedIds accumulate uniquely in first-visit order across back/forward", async () => {
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

  it("completed fires only on a successful complete()", async () => {
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

// ---------------------------------------------------------------------------
// FLAG G-14: silent fallback when the current step becomes invisible
// ---------------------------------------------------------------------------
describe("FLAG G-14: current step becomes invisible", () => {
  it("silently falls back to the FIRST visible step (jumps past nearer steps)", async () => {
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

  it("stale currentIdBox resurfaces: hiding then re-showing the current step jumps back to it", async () => {
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

  it("keeps the current step when it stays visible even if OTHER steps hide", async () => {
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

// ---------------------------------------------------------------------------
// Scope algorithm: isolation + no scope leakage across nav effects
// ---------------------------------------------------------------------------
describe("scope algorithm", () => {
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

  it("awaiting nav effects preserves the ambient scope (no leak, no drop)", async () => {
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

// ---------------------------------------------------------------------------
// createWizardForm
// ---------------------------------------------------------------------------
describe("createWizardForm", () => {
  it("builds a root form and wizard together (steps as a function)", async () => {
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

  it("resolves { pick }, { form: object }, { form: true } step variants", async () => {
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

  it("passes a form-like step through unchanged (isFormLike branch)", async () => {
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

  it("read() of a createWizardForm returns the root form values", async () => {
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

// ---------------------------------------------------------------------------
// Additional corner cases (adversarial verification)
// ---------------------------------------------------------------------------
describe("navigation over hidden steps", () => {
  it("next() skips a hidden intermediate step: advances to the next VISIBLE step, validating current", async () => {
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

  it("back() skips a hidden intermediate step: returns to the previous VISIBLE step", async () => {
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

  it("next()/back()/goTo() all return false when every step is hidden (index -1)", async () => {
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

describe("forward goTo validates the CURRENT step", () => {
  it("blocks and returns false when the current step itself is invalid (loop starts at current index)", async () => {
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

describe("completedIds never duplicates", () => {
  it("re-completing an already-completed step does not append a duplicate (appendUnique)", async () => {
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

  it("complete() called twice keeps completedIds unique but re-emits completed each time", async () => {
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

describe("complete() with a root form", () => {
  it("emits completed(root.read()) — the whole root form values, not per-step keys", async () => {
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

describe("duplicate step ids (wild input)", () => {
  it("two steps sharing an id: find/index resolve to the FIRST match, so next() cannot leave it", async () => {
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
