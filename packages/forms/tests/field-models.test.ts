import { computed, effect, scope, scoped, serialize, store } from "@virentia/core";
import { modelInstanceBindingOf, withUnitDeclarationTracker } from "@virentia/core/internal";
import { children, refs, staticModel } from "@virentia/core/models";
import { expect, it, vi } from "vitest";
import { createArrayField, createField, createForm, createShapeField, type ValidationPayload } from "../lib";
import { fieldModel } from "../lib/models";
import { normalizeField } from "../lib/shared";
import { deferred, tick } from "./_helpers";

it("composes complete owned Field models through the existing Form API with no per-instance units", async () => {
  const Email = fieldModel("", { name: "NativeEmail", validate: value => value.includes("@") ? null : "Invalid" });
  const Form = staticModel({
    name: "NativeSignup", data: { email: children.one(Email) },
    setup(self) { return { form: createForm({ schema: () => ({ email: self.email.value!.field }) }) }; },
    onCreate(self) { if (!self.email.value) self.email.create({}); },
  });
  const app = scope(), counts: string[] = [];
  const [a, b] = withUnitDeclarationTracker(kind => counts.push(kind), () => scoped(app, () => Form.create([{ id: "a" }, { id: "b" }])));
  try {
    expect(counts).toEqual([]);
    expect(a.form.fields.email).toBe(a.email.value!.field);
    expect(a.form.fields.email.state.node).toBe(b.form.fields.email.state.node);
    await a.form.fill({ values: { email: "a@example.com" } });
    expect(a.form.values.value).toEqual({ email: "a@example.com" });
    expect(b.form.values.value).toEqual({ email: "" });
    expect(a.form.isChanged.value).toBe(true);
    expect(b.form.isChanged.value).toBe(false);
    await a.form.validate();
    expect(a.form.isValid.value).toBe(true);
    await b.form.validate();
    expect(b.form.errors.value).toEqual({ email: "Invalid" });
    await a.form.reset();
    expect(a.form.values.value).toEqual({ email: "" });
    expect(a.form.isChanged.value).toBe(false);
  } finally { await a.dispose(); await b.dispose(); }
});

it("captures loaded child defaults and restores values, metadata and the original Form snapshot", async () => {
  const Email = fieldModel("", { name: "RestoredEmail", meta: { label: "Email" } });
  const Model = staticModel({
    name: "RestoredForm", data: { email: children.one(Email) },
    setup(self) { return { form: createForm({ schema: () => ({ email: self.email.value!.field }) }) }; },
    onCreate(self) { if (!self.email.value) self.email.create({}); },
  });
  const server = scope(), original = scoped(server, () => Model.create({ id: "form", email: { value: "initial@example.com" } }));
  expect(original.form.snapshot.value).toEqual({ email: "initial@example.com" });
  await original.form.fill({ values: { email: "edited@example.com" } });
  const dto = original.json(), snapshot = serialize(server), client = scope({ snapshot });
  const copy = scoped(client, () => Model.create(dto));
  try {
    expect(copy.form.values.value).toEqual({ email: "edited@example.com" });
    expect(copy.form.snapshot.value).toEqual({ email: "initial@example.com" });
    expect(copy.form.isChanged.value).toBe(true);
    expect(copy.email.value!.initialValue.value).toBe("initial@example.com");
    await copy.form.reset();
    expect(copy.form.values.value).toEqual({ email: "initial@example.com" });
    expect(original.form.values.value).toEqual({ email: "edited@example.com" });
  } finally { await copy.dispose(); await original.dispose(); }
});

it("shares a referenced field without transferring ownership to either Form", async () => {
  const Email = fieldModel("", { name: "SharedNativeEmail" });
  const Draft = staticModel({ data: { email: children.one(Email) }, onCreate(self) { self.email.create({}); } });
  const Editor = staticModel({
    data: { email: refs.one(Email).policy("nullify") },
    setup(self) { return { form: createForm({ schema: () => self.email.value ? { email: self.email.value.field } : {} }) }; },
  });
  const app = scope();
  const [draft, a, b] = scoped(app, () => {
    const draft = Draft.create({});
    return [draft, Editor.create({ email: draft.email.value!.id }), Editor.create({ email: draft.email.value!.id })] as const;
  });
  try {
    await a.form.fill({ values: { email: "shared@example.com" } });
    expect(b.form.values.value).toEqual({ email: "shared@example.com" });
    await a.dispose();
    expect(draft.email.value!.alive).toBe(true);
    await b.form.fields.email!.fill("other@example.com");
    expect(draft.email.value!.field.state.value).toBe("other@example.com");
    await draft.dispose();
    expect(b.form.values.value).toEqual({});
  } finally { await a.dispose(); await b.dispose(); await draft.dispose(); }
});

it("keeps change validation scoped, including repeated same-value fills", async () => {
  const validate = vi.fn((_values: unknown) => null);
  const Email = fieldModel("", { name: "ChangeEmail" });
  const Model = staticModel({
    data: { email: children.one(Email) },
    setup(self) { return { form: createForm({ schema: () => ({ email: self.email.value!.field }), validation: validate, validationStrategies: ["change"] }) }; },
    onCreate(self) { self.email.create({}); },
  });
  const [a, b] = scoped(scope(), () => Model.create([{}, {}]));
  try {
    expect(validate).not.toHaveBeenCalled();
    await a.form.fields.email.fill("same@example.com");
    await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(1));
    await a.form.fields.email.fill("same@example.com");
    await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(2));
    expect(b.form.values.value).toEqual({ email: "" });
  } finally { await a.dispose(); await b.dispose(); }
});

it("binds ordinary native Field and Form objects returned together from setup", async () => {
  const Model = staticModel({ setup() {
    const field = createField(1);
    const form = createForm({ schema: { count: field } });
    return { form, field };
  } });
  const [a, b] = scoped(scope(), () => Model.create([{}, {}]));
  try {
    await a.field.fill(3);
    expect(a.form.fields.count.state.value).toBe(3);
    expect(b.form.fields.count.state.value).toBe(1);
    expect(a.form.values.value).toEqual({ count: 3 });
  } finally { await a.dispose(); await b.dispose(); }
});

it("tracks repeated child writes and projections after the first cached read", async () => {
  const Email = fieldModel("", { name: "CachedEmail" });
  const Signup = staticModel({
    data: { email: children.one(Email) },
    setup(self) { return { form: createForm({ schema: () => ({ email: self.email.value!.field }) }) }; },
    onCreate(self) { self.email.create({}); },
  });
  const row = scoped(scope(), () => Signup.create({}));
  try {
    const projection = row.form.pick({ email: true });
    expect([row.form.values.value, projection.values.value]).toEqual([{ email: "" }, { email: "" }]);
    for (const value of ["first", "second", "third"]) {
      await row.form.fields.email.fill(value);
      expect(row.email.value!.value.value).toBe(value);
      expect(row.form.values.value).toEqual({ email: value });
      expect(projection.values.value).toEqual({ email: value });
    }
    await projection.reset();
    expect(row.form.values.value).toEqual({ email: "" });
  } finally { await row.dispose(); }
});

it("does not revalidate unrelated Forms when one of many child fields changes", async () => {
  const validate = vi.fn((_values: unknown) => null);
  const Email = fieldModel("");
  const Signup = staticModel({
    data: { email: children.one(Email) },
    setup(self) { return { form: createForm({ schema: () => ({ email: self.email.value!.field }), validation: validate, validationStrategies: ["change"] }) }; },
    onCreate(self) { self.email.create({}); },
  });
  const rows = scoped(scope(), () => Signup.create(Array.from({ length: 20 }, () => ({}))));
  try {
    await rows[7].form.fields.email.fill("one");
    await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(1));
    expect(validate.mock.calls[0][0]).toEqual({ email: "one" });
  } finally { await Promise.all(rows.map(row => row.dispose())); }
});

it("follows ref replacement and detaches validation from the previous child", async () => {
  const validate = vi.fn(() => null), Email = fieldModel("");
  const Draft = staticModel({ data: { email: children.one(Email) }, onCreate(self) { self.email.create({}); } });
  const Editor = staticModel({
    data: { email: refs.one(Email).policy("nullify") },
    setup(self) { return { form: createForm({ schema: () => self.email.value ? { email: self.email.value.field } : {}, validation: validate, validationStrategies: ["change"] }) }; },
  });
  const app = scope(), [first, second] = scoped(app, () => Draft.create([{}, {}]));
  const editor = scoped(app, () => Editor.create({ email: first.email.value!.id }));
  try {
    const previous = editor.form.fields.email!;
    editor.email.value = second.email.value;
    await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(1));
    expect(editor.form.fields.email).toBe(second.email.value!.field);
    await previous.fill("detached");
    await tick();
    expect(validate).toHaveBeenCalledTimes(1);
    await editor.form.fields.email!.fill("current");
    await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(2));
    expect(editor.form.values.value).toEqual({ email: "current" });
  } finally { await editor.dispose(); await first.dispose(); await second.dispose(); }
});

it("isolates async validation and aborts only the disposed child's run", async () => {
  const pending = new Map<string, ReturnType<typeof deferred<string | null>>>();
  const signals = new Map<string, AbortSignal>();
  const Email = fieldModel("", { validate(value, ctx) {
    const gate = deferred<string | null>(); pending.set(value, gate); signals.set(value, ctx.signal);
    return gate.promise;
  } });
  const Draft = staticModel({ data: { email: children.one(Email) }, onCreate(self) { self.email.create({}); } });
  const app = scope(), other = scope();
  const a = scoped(app, () => Draft.create({ id: "same" })), b = scoped(other, () => Draft.create({ id: "same" }));
  try {
    await a.email.value!.field.fill("a"); await b.email.value!.field.fill("b");
    const first = a.email.value!.field.validate().catch(error => error), second = b.email.value!.field.validate();
    await vi.waitFor(() => expect(pending.size).toBe(2));
    expect([a.email.value!.field.isValidationPending.value, b.email.value!.field.isValidationPending.value]).toEqual([true, true]);
    await a.dispose();
    expect(signals.get("a")!.aborted).toBe(true);
    expect(signals.get("b")!.aborted).toBe(false);
    pending.get("a")!.resolve("stale"); pending.get("b")!.resolve(null);
    expect(await first).toBeInstanceOf(Error);
    await second;
    expect(b.email.value!.field.error.value).toBeNull();
    expect(b.email.value!.field.isValidationPending.value).toBe(false);
  } finally { for (const gate of pending.values()) gate.resolve(null); await a.dispose(); await b.dispose(); }
});

it("preserves application handler overrides for a shared Field definition", async () => {
  const validator = effect<ValidationPayload<string>, string | null>(() => "Default");
  const Email = fieldModel("", { validate: validator });
  const Draft = staticModel({ data: { email: children.one(Email) }, onCreate(self) { self.email.create({}); } });
  const a = scoped(scope(), () => Draft.create({}));
  const b = scoped(scope({ handlers: [[validator, () => null]] }), () => Draft.create({}));
  try {
    await a.email.value!.field.validate(); await b.email.value!.field.validate();
    expect([a.email.value!.field.error.value, b.email.value!.field.error.value]).toEqual(["Default", null]);
  } finally { await a.dispose(); await b.dispose(); }
});

it("normalizes complete model-owned native fields without declaring wrappers or replacing their handlers", () => {
  const kinds: string[] = [];
  staticModel({ setup() {
    const fields = [createField(1), createArrayField([1]), createShapeField({ count: createField(1) })];
    withUnitDeclarationTracker(kind => kinds.push(kind), () => {
    for (const field of fields) {
      const normalized = normalizeField<any, any, any>(field);
      expect(normalized).toBe(field);
      expect(normalizeField(normalized)).toBe(normalized);
      expect(normalized.fill).toBe(field.fill);
      expect(normalized.reset).toBe(field.reset);
    }
    });
  } });
  expect(kinds).toEqual([]);
});

it("preserves application-scoped Forms declared outside model setup", async () => {
  const field = createField(""), form = createForm({ schema: { email: field } });
  const Row = staticModel({ setup() { return { form }; } });
  const app = scope(), [a, b] = scoped(app, () => Row.create([{}, {}]));
  try {
    expect(a.form).toBe(form);
    expect(b.form).toBe(form);
    await scoped(app, () => a.form.fill({ values: { email: "shared in app" } }));
    expect(scoped(app, () => b.form.values.value)).toEqual({ email: "shared in app" });
  } finally { await a.dispose(); await b.dispose(); }
});

it("captures the initial snapshot without prewarming the child's computed state", async () => {
  const Count = fieldModel(0);
  const Parent = staticModel({
    data: { count: children.one(Count) },
    setup(self) { return { form: createForm({ schema: () => ({ count: self.count.value!.field }) }) }; },
  });
  const parent = scoped(scope(), () => Parent.create({ count: { value: 7 } }));
  try {
    const child = parent.count.value!, state = child.field.state;
    const home = modelInstanceBindingOf(child)!.scope;
    const key = (state.node as unknown as { valueKey: symbol }).valueKey;
    expect(typeof key).toBe("symbol");
    expect(parent.form.snapshot.value).toEqual({ count: 7 });
    expect(home.values.has(key)).toBe(false);
    expect(state.value).toBe(7);
    expect(home.values.has(key)).toBe(true);
    const cached = home.values.get(key);
    expect(state.value).toBe(7);
    expect(home.values.get(key)).toBe(cached);
  } finally { await parent.dispose(); }
});

it("invalidates application computeds that read fields through a replaced reference", async () => {
  const Email = fieldModel("");
  const Draft = staticModel({ data: { email: children.one(Email) }, onCreate(self) { self.email.create({}); } });
  const Editor = staticModel({
    data: { email: refs.one(Email).policy("nullify") },
    setup(self) { return { form: createForm({ schema: () => self.email.value ? { email: self.email.value.field } : {} }) }; },
  });
  const app = scope(), [first, second] = scoped(app, () => Draft.create([{}, {}]));
  await first.email.value!.field.fill("first"); await second.email.value!.field.fill("second");
  const editor = scoped(app, () => Editor.create({ email: first.email.value!.id }));
  const fields = editor.form.fields;
  const value = computed(() => fields.email?.state.value ?? "missing");
  try {
    expect(scoped(app, () => value.value)).toBe("first");
    editor.email.value = second.email.value;
    expect(scoped(app, () => value.value)).toBe("second");
    await second.dispose();
    expect(scoped(app, () => value.value)).toBe("missing");
  } finally { await editor.dispose(); await first.dispose(); await second.dispose(); }
});

it("revalidates a Form when ctx.read observes a different child scope", async () => {
  let calls = 0;
  const Text = fieldModel(""), Limit = fieldModel(1);
  const Parent = staticModel({ data: { email: children.one(Text), limit: children.one(Limit) },
    setup(self) { return { form: createForm({ schema: () => ({ email: self.email.value!.field }),
      validation(_values, ctx) { calls++; return ctx.read(self.limit.value!.field.state) ? { email: "Blocked" } : null; },
    }) }; },
    onCreate(self) { self.email.create({}); self.limit.create({}); },
  });
  const parent = scoped(scope(), () => Parent.create({}));
  try {
    await parent.form.validate();
    expect(parent.form.errors.value).toEqual({ email: "Blocked" });
    await parent.limit.value!.field.fill(0);
    await vi.waitFor(() => {
      expect(calls).toBe(2);
      expect(parent.form.isValidationPending.value).toBe(false);
      expect(parent.form.errors.value).toEqual({ email: null });
    });
    await tick();
  } finally { await parent.dispose(); }
});

it("revalidates owned fields for app dependencies without crossing applications", async () => {
  const minimum = store(1);
  const Number = fieldModel(0, { validate(value, ctx) { return value < ctx.read(minimum) ? "Too small" : null; } });
  const Parent = staticModel({ data: { amount: children.one(Number) },
    setup() { return { setMinimum(value: number) { minimum.value = value; } }; },
    onCreate(self) { self.amount.create({}); } });
  const first = scope(), second = scope();
  const a = scoped(first, () => Parent.create({})), b = scoped(second, () => Parent.create({}));
  try {
    await a.amount.value!.field.validate(); await b.amount.value!.field.validate();
    scoped(first, () => { minimum.value = 0; });
    await vi.waitFor(() => {
      expect(a.amount.value!.field.isValidationPending.value).toBe(false);
      expect(a.amount.value!.field.error.value).toBeNull();
    });
    expect(b.amount.value!.field.error.value).toBe("Too small");
    a.setMinimum(1);
    await vi.waitFor(() => expect(a.amount.value!.field.error.value).toBe("Too small"));
    await tick();
  } finally { await a.dispose(); await b.dispose(); }
});
