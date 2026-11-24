import { scope, scoped, serialize } from "@virentia/core";
import { withUnitDeclarationTracker } from "@virentia/core/internal";
import { expect, it, vi } from "vitest";
import { declareFieldOwnershipExample } from "../../../docs/examples/field-ownership";

it("reuses one field definition across form types without declaring units per child", async () => {
  let values = 0, rules = 0;
  const { Email, Signup, Recovery } = declareFieldOwnershipExample({
    onValueSetup: () => { values++; }, onRulesSetup: () => { rules++; },
  });
  expect([values, rules]).toEqual([1, 1]);
  const app = scope(), declarations: string[] = [];
  const forms = withUnitDeclarationTracker(kind => declarations.push(kind), () => scoped(app, () =>
    Array.from({ length: 12 }, (_, i) => (i % 2 ? Recovery : Signup).create({ id: String(i) })),
  ));
  try {
    expect(declarations).toEqual([]);
    expect([values, rules]).toEqual([1, 1]);
    const first = forms[0].email.value!, second = forms[1].email.value!;
    expect(first).not.toBe(second);
    expect(first.id).not.toBe(second.id);
    expect(first.state.node).toBe(second.state.node);
    const seenFirst: string[] = [], seenSecond: string[] = [];
    const offFirst = first.state.subscribe(value => seenFirst.push(value));
    const offSecond = second.state.subscribe(value => seenSecond.push(value));
    try {
      await first.fill("ada@example.com");
      expect(seenFirst).toEqual(["ada@example.com"]);
      expect(seenSecond).toEqual([]);
    } finally { offFirst(); offSecond(); }
    await first.focus();
    expect(forms[0].values.value).toEqual({ email: "ada@example.com" });
    expect(forms[1].values.value).toEqual({ email: "" });
    expect(first.error.value).toBeNull();
    expect(second.error.value).toBe("Use a valid email");
    expect(second.focused.value).toBe(false);
    await forms[0].dispose();
    expect(first.alive).toBe(false);
    expect(second.alive).toBe(true);
    expect(scoped(app, () => Email.instances.count)).toBe(11);
  } finally {
    for (const form of forms) await form.dispose();
  }
});

it("shares one instance through refs while keeping one owning draft", async () => {
  const { SharedDraft, LinkedForm } = declareFieldOwnershipExample();
  const app = scope(), other = scope();
  const [draft, first, second] = scoped(app, () => [
    SharedDraft.create({}), LinkedForm.create({ id: "first" }), LinkedForm.create({ id: "second" }),
  ] as const);
  const foreign = scoped(other, () => LinkedForm.create({}));
  try {
    const email = draft.email.value!;
    first.email.value = email;
    second.email.value = email;
    expect(() => { foreign.email.value = email; }).toThrow(/different scope/);
    await email.fill("shared@example.com");
    expect(first.values.value).toEqual({ email: "shared@example.com" });
    expect(second.values.value).toEqual(first.values.value);
    await first.dispose();
    expect(email.alive).toBe(true);
    expect(second.email.value).toBe(email);
    await email.fill("changed@example.com");
    expect(second.values.value).toEqual({ email: "changed@example.com" });
    await draft.dispose();
    expect(email.alive).toBe(false);
    expect(second.email.value).toBeNull();
    expect(second.values.value).toEqual({ email: "" });
  } finally {
    await first.dispose(); await second.dispose(); await draft.dispose(); await foreign.dispose();
  }
});

it("cancels an owned child's async work and isolates a reused form ID", async () => {
  let signal: AbortSignal | undefined, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { Signup } = declareFieldOwnershipExample({ check(_value, current) {
    signal = current;
    return gate;
  } });
  const app = scope(), form = scoped(app, () => Signup.create({ id: "same", email: { value: "old@example.com" } }));
  const old = form.email.value!;
  const checking = old.check().catch(error => error);
  try {
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(old.isChecking.value).toBe(true);
    await form.dispose();
    expect(signal!.aborted).toBe(true);
    expect(old.alive).toBe(false);
    expect(await checking).toBe(signal!.reason);
    const reused = scoped(app, () => Signup.create({ id: "same" }));
    try {
      expect(reused.email.value!.state.value).toBe("");
      expect(reused.email.value!.focused.value).toBe(false);
      expect(reused.email.value!.isChecking.value).toBe(false);
      expect(() => old.state.value).toThrow(/disposed/);
    } finally { await reused.dispose(); }
  } finally {
    release(); await checking; await form.dispose();
  }
});

it("restores owned field data in another application without recreating trait setups", async () => {
  let setups = 0;
  const { Signup } = declareFieldOwnershipExample({ onValueSetup() { setups++; } });
  const server = scope(), form = scoped(server, () => Signup.create({ id: "signup", email: { value: "server@example.com" } }));
  await form.email.value!.focus();
  const dto = form.json(), snapshot = serialize(server), client = scope({ snapshot });
  const copy = scoped(client, () => Signup.create(dto));
  try {
    expect(copy.email.value!.state.value).toBe("server@example.com");
    expect(copy.email.value!.focused.value).toBe(true);
    expect(copy.email.value!.state.node).toBe(form.email.value!.state.node);
    expect(setups).toBe(1);
    await copy.email.value!.fill("client@example.com");
    expect(form.values.value).toEqual({ email: "server@example.com" });
    expect(copy.values.value).toEqual({ email: "client@example.com" });
  } finally { await copy.dispose(); await form.dispose(); }
});

it("uses static only to request a separate standalone native graph", async () => {
  let setups = 0;
  const { Email, Signup } = declareFieldOwnershipExample({ onValueSetup() { setups++; } });
  const standalone = Email.static({ value: "standalone@example.com" });
  expect(setups).toBe(2);
  const app = scope(), form = scoped(app, () => Signup.create({}));
  try {
    expect(standalone.state.node).not.toBe(form.email.value!.state.node);
    expect(scoped(app, () => standalone.state.value)).toBe("standalone@example.com");
    await form.dispose();
    expect(scoped(app, () => standalone.alive)).toBe(true);
    expect(scoped(app, () => standalone.state.value)).toBe("standalone@example.com");
  } finally { await form.dispose(); await scoped(app, () => standalone.dispose()); }
});
