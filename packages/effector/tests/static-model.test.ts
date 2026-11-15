import { expect, it } from "vitest";
import { scope, scoped } from "@virentia/core";
import { children, refs, staticModel } from "@virentia/core/models";
import { associate } from "@virentia/effector";
import { allSettled, createStore, fork } from "effector";
import { createArrayField, createField, createForm, createShapeField } from "@virentia/forms";
import { fieldModel } from "@virentia/forms/models";
import { formToEffector } from "../lib";
import { setupForm } from "./helpers";

it("bridges independently owned fields and complete forms into one associated application", async () => {
  const Email = fieldModel("", { validate: value => value.includes("@") ? null : "Email required" });
  const Signup = staticModel({
    data: { email: children.one(Email) },
    setup(self) { return { form: createForm({ schema: () => ({ email: self.email.value!.field }) }) }; },
    onCreate(self) { if (!self.email.value) self.email.create({}); },
  });
  const app = scope(), otherApp = scope(), ef = fork(), otherEf = fork();
  associate({ virentia: app, effector: ef }); associate({ virentia: otherApp, effector: otherEf });
  const [a, b] = scoped(app, () => Signup.create([{ email: { value: "a@x" } }, { email: { value: "b@x" } }]));
  const c = scoped(otherApp, () => Signup.create({ email: { value: "c@x" } }));
  const [ea, eb] = scoped(app, () => [formToEffector(a.form), formToEffector(b.form)]);
  const ec = scoped(otherApp, () => formToEffector(c.form));
  try {
    expect(ef.getState(ea.$values)).toEqual({ email: "a@x" });
    expect(ef.getState(eb.$values)).toEqual({ email: "b@x" });
    await allSettled(ea.fill, { scope: ef, params: { values: { email: "first@x" } } });
    expect(a.email.value!.field.read()).toBe("first@x");
    expect(ef.getState(ea.$values)).toEqual({ email: "first@x" });
    expect(ef.getState(eb.$values)).toEqual({ email: "b@x" });
    expect(otherEf.getState(ec.$values)).toEqual({ email: "c@x" });
    const wrong = await allSettled(ea.fill, { scope: otherEf, params: { values: { email: "foreign" } } });
    expect(wrong.status).toBe("fail");
    expect(a.email.value!.field.read()).toBe("first@x");
    const change = scoped(app, () => ea.fields.email.change.target());
    await allSettled(change, { scope: ef, params: "invalid" });
    await allSettled(ea.validate, { scope: ef });
    expect(ef.getState(ea.$errors)).toEqual({ email: "Email required" });
    expect(ef.getState(eb.$errors)).toEqual({ email: null });
    await allSettled(ea.reset, { scope: ef });
    expect(ef.getState(ea.$values)).toEqual({ email: "a@x" });
  } finally { await a.dispose(); await b.dispose(); await c.dispose(); }
});

it("keeps bridged methods callable from an associated Virentia scope", async () => {
  const h = setupForm(createForm({ schema: { email: createField("initial") } }));
  await h.drive(() => h.model.fill({ values: { email: "from core" } }));
  expect(h.read(h.model.$values)).toEqual({ email: "from core" });
});

it("exposes real Effector pending and doneData on bridged form methods", async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const h = setupForm(createForm({ schema: { email: createField("x", { validate: async () => { await gate; return null; } }) } }));
  const $done = createStore(0).on(h.model.validate.doneData, n => n + 1);
  const pending = allSettled(h.model.validate, { scope: h.eScope });
  try {
    expect(h.eScope.getState(h.model.validate.pending)).toBe(true);
    finish(); await pending;
    expect(h.eScope.getState(h.model.validate.pending)).toBe(false);
    expect(h.eScope.getState($done)).toBe(1);
  } finally { finish(); await pending; }
});

it("follows replaced field refs on fresh lens access and keeps their owner alive", async () => {
  const Email = fieldModel("");
  const Draft = staticModel({ data: { email: children.one(Email) }, onCreate(self) { if (!self.email.value) self.email.create({}); } });
  const Editor = staticModel({
    data: { email: refs.one(Email).policy("nullify") },
    setup(self) { return { form: createForm({ schema: () => self.email.value ? { email: self.email.value.field } : {} }) }; },
  });
  const app = scope(), ef = fork(); associate({ virentia: app, effector: ef });
  const [first, second] = scoped(app, () => Draft.create([{ email: { value: "first" } }, { email: { value: "second" } }]));
  const editor = scoped(app, () => Editor.create({})); editor.email.value = first.email.value;
  const view = scoped(app, () => formToEffector(editor.form));
  try {
    const old = view.fields.email;
    editor.email.value = second.email.value;
    expect(ef.getState(view.$values)).toEqual({ email: "second" });
    const change = scoped(app, () => view.fields.email!.change.target());
    await allSettled(change, { scope: ef, params: "changed" });
    expect(first.email.value!.field.read()).toBe("first");
    expect(second.email.value!.field.read()).toBe("changed");
    expect(view.fields.email).not.toBe(old);
    await editor.dispose();
    expect(second.email.value!.alive).toBe(true);
  } finally { await editor.dispose(); await first.dispose(); await second.dispose(); }
});

it("bridges nested groups of owned field models and scoped leaf clocks", async () => {
  const Email = fieldModel(""), Phone = fieldModel("");
  const Profile = staticModel({
    data: { email: children.one(Email), phone: children.one(Phone) },
    setup(self) { return { form: createForm({ schema: () => ({ profile: {
      email: self.email.value!.field, phone: self.phone.value!.field,
    } }) }) }; },
    onCreate(self) {
      if (!self.email.value) self.email.create({});
      if (!self.phone.value) self.phone.create({});
    },
  });
  const app = scope(), ef = fork(); associate({ virentia: app, effector: ef });
  const [a, b] = scoped(app, () => Profile.create([{}, {}]));
  const view = scoped(app, () => formToEffector(a.form));
  const $email = createStore<string[]>([]).on(scoped(app, () => view.fields.profile.email.state.clock()), (seen, value) => [...seen, value]);
  try {
    await allSettled(view.fill, { scope: ef, params: { values: { profile: { email: "a@x", phone: "123" } } } });
    await b.email.value!.field.fill("b@x");
    expect(ef.getState(view.$values)).toEqual({ profile: { email: "a@x", phone: "123" } });
    expect(ef.getState($email)).toEqual(["a@x"]);
    expect(Object.keys(view.fields.profile)).toEqual(["email", "phone"]);
    expect(view.fields.profile.email).toBe(view.fields.profile.email);
  } finally { await a.dispose(); await b.dispose(); }
});

it("targets model collection fields through the existing Effector lenses", async () => {
  const Row = staticModel({ setup() {
    const tags = createArrayField(["a", "b"]), details = createShapeField({ name: createField("initial") });
    return { tags, details, form: createForm({ schema: { tags, details } }) };
  } });
  const app = scope(), ef = fork(); associate({ virentia: app, effector: ef });
  const [a, b] = scoped(app, () => Row.create([{}, {}]));
  const view = scoped(app, () => formToEffector(a.form));
  try {
    const fill = scoped(app, () => view.fields.tags.first().change.target());
    await allSettled(fill, { scope: ef, params: "changed" });
    expect(a.tags.state.value).toEqual(["changed", "b"]);
    expect(b.tags.state.value).toEqual(["a", "b"]);
    await allSettled(view.fill, { scope: ef, params: { values: { details: { name: "Ada" } } } });
    expect(ef.getState(view.$values)).toEqual({ tags: ["changed", "b"], details: { name: "Ada" } });
    const source = scoped(app, () => view.fields.tags.getSource()), ids = Object.keys(source);
    await a.tags.move(0, 1);
    expect(scoped(app, () => view.fields.tags.getSource())[ids[0]]).toBe(source[ids[0]]);
    expect(scoped(app, () => Object.keys(view.fields.tags.first().getSource()))).toEqual([ids[1]]);
  } finally { await a.dispose(); await b.dispose(); }
});
