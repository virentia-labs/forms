import { reaction, scope, scoped, serialize } from "@virentia/core";
import { withUnitDeclarationTracker } from "@virentia/core/internal";
import { staticModel } from "@virentia/core/models";
import { expect, it } from "vitest";
import { createField, createForm, createWizard, createWizardForm, step } from "../lib";
import { Signup as DocumentedSignup } from "../../../docs/examples/model-wizard";

it("binds a wizard and every form returned by its stores to the model instance", async () => {
  const Signup = staticModel({ setup() {
    return { wizard: createWizardForm({
      schema: {
        email: createField("", { validate: value => value.includes("@") ? null : "Email required" }),
        name: createField(""),
      },
      steps: [step("account", { pick: { email: true } }), step("profile", { pick: { name: true } })] as const,
    }) };
  } });
  const app = scope(), other = scope(), declarations: string[] = [];
  const [a, b, c] = withUnitDeclarationTracker(kind => declarations.push(kind), () => [
    scoped(app, () => Signup.create({ id: "same" })),
    scoped(app, () => Signup.create({ id: "sibling" })),
    scoped(other, () => Signup.create({ id: "same" })),
  ]);
  const changes: string[] = [];
  const watcher = reaction({ on: a.wizard.changed, run(id) { changes.push(id); } });
  try {
    expect(declarations).toEqual([]);
    expect(a.wizard.currentId.node).toBe(b.wizard.currentId.node);
    expect(a.wizard.currentId.value).toBe("account");
    const account = a.wizard.currentForm.value;
    expect(a.wizard.currentStep.value.form).toBe(account);
    expect(a.wizard.steps.value[0].form).toBe(account);
    expect(a.wizard.visibleSteps.value[0].form).toBe(account);
    expect(account).not.toBe(b.wizard.currentForm.value);
    expect(await a.wizard.next()).toBe(false);
    await account.fill({ values: { email: "ada@example.com" } });
    expect(await a.wizard.next()).toBe(true);
    expect(a.wizard.currentStep.value.form).toBe(a.wizard.steps.value[1].form);
    await a.wizard.currentStep.value.form.fill({ values: { name: "Ada" } });
    expect(a.wizard.form.values.value).toEqual({ email: "ada@example.com", name: "Ada" });
    expect([b.wizard.currentId.value, c.wizard.currentId.value]).toEqual(["account", "account"]);
    expect(b.wizard.form.values.value).toEqual({ email: "", name: "" });
    expect(changes).toEqual(["profile"]);
    expect(await a.wizard.complete()).toBe(true);
    await a.wizard.reset();
    expect(a.wizard.read()).toEqual({ email: "", name: "" });
    expect(a.wizard.currentId.value).toBe("account");
  } finally { watcher.stop(); await a.dispose(); await b.dispose(); await c.dispose(); }
});

it("binds inline steps, preserves a borrowed form owner and reuses a disposed wizard identity", async () => {
  const FormModel = staticModel({ setup() { return { form: createForm({ schema: { note: createField("") } }) }; } });
  const Flow = staticModel({ setup() {
    const first = createForm({ schema: { name: createField("") } });
    const second = createForm({ schema: { age: createField(0) } });
    return { wizard: createWizard({ steps: [{ id: "first", form: first }, { id: "second", form: second }] as const }) };
  } });
  const app = scope(), a = scoped(app, () => Flow.create({ id: "flow" }));
  const owner = scoped(app, () => FormModel.create({}));
  const Borrower = staticModel({ setup() {
    return { wizard: createWizard({ steps: [step("borrowed", { form: owner.form })] }) };
  } });
  const borrower = scoped(app, () => Borrower.create({}));
  try {
    await a.wizard.currentForm.value.fill({ values: { name: "first" } });
    await a.wizard.steps.value[1].form.fill({ values: { age: 42 } });
    expect(a.wizard.read()).toEqual({ first: { name: "first" }, second: { age: 42 } });
    const stale = a.wizard.currentForm.value;
    await a.dispose();
    expect(() => stale.read()).toThrow(/disposed/);
    const fresh = scoped(app, () => Flow.create({ id: "flow" }));
    try {
      expect(fresh.wizard.currentId.value).toBe("first");
      expect(fresh.wizard.read()).toEqual({ first: { name: "" }, second: { age: 0 } });
    } finally { await fresh.dispose(); }
    expect(borrower.wizard.currentForm.value).toBe(owner.form);
    await borrower.wizard.currentForm.value.fill({ values: { note: "shared" } });
    await borrower.dispose();
    expect(owner.alive).toBe(true);
    expect(owner.form.values.value).toEqual({ note: "shared" });
  } finally { await a.dispose(); await borrower.dispose(); await owner.dispose(); }
});

it("restores wizard fields from owned model DTOs without sharing request state", async () => {
  const server = scope(), declarations: string[] = [];
  const original = withUnitDeclarationTracker(kind => declarations.push(kind), () =>
    scoped(server, () => DocumentedSignup.create({ id: "signup" })));
  expect(declarations).toEqual([]);
  await original.wizard.currentForm.value.fill({ values: { email: "server@example.com" } });
  await original.wizard.next();
  const restored = scoped(scope({ snapshot: JSON.parse(JSON.stringify(serialize(server))) }), () => DocumentedSignup.create(original.json()));
  try {
    expect(restored.wizard.form.values.value).toEqual({ email: "server@example.com", name: "" });
    // Navigation stores are runtime state; reconstruct progress explicitly.
    expect(restored.wizard.currentId.value).toBe("account");
    await restored.wizard.goTo("review");
    await restored.wizard.currentForm.value.fill({ values: { email: "client@example.com" } });
    expect(original.wizard.form.values.value).toEqual({ email: "server@example.com", name: "" });
    await restored.wizard.reset();
    expect(restored.wizard.form.values.value).toEqual({ email: "", name: "" });
  } finally { await original.dispose(); await restored.dispose(); }
});

it("keeps the fallback form bound when every step is hidden", async () => {
  const Flow = staticModel({ setup() {
    const form = createForm({ schema: { note: createField("") } });
    return { wizard: createWizard({ steps: [step("hidden", { form, when: () => false })] }) };
  } });
  const [a, b] = scoped(scope(), () => Flow.create([{}, {}]));
  try {
    expect(a.wizard.visibleSteps.value).toEqual([]);
    expect(await a.wizard.next()).toBe(false);
    await a.wizard.currentForm.value.fill({ values: { note: "fallback" } });
    expect(a.wizard.currentStep.value.form.read()).toEqual({ note: "fallback" });
    expect(b.wizard.currentForm.value.read()).toEqual({ note: "" });
  } finally { await a.dispose(); await b.dispose(); }
});
