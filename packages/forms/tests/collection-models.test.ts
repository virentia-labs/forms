import { scope, scoped, serialize } from "@virentia/core";
import { modelInstanceBindingOf, withUnitDeclarationTracker } from "@virentia/core/internal";
import { children, staticModel } from "@virentia/core/models";
import { expect, it, vi } from "vitest";
import { createField, createForm, fieldType } from "../lib";
import { arrayFieldModel, fieldModel, shapeFieldModel } from "../lib/models";
import { fieldModelSource } from "../lib/model-field-binding";
import { deferred } from "./_helpers";
import { Profile as DocumentedProfile } from "../../../docs/examples/all-fields";

it("creates array items as owned model instances without declaring instance units", async () => {
  const Email = fieldModel("", { name: "CollectionModelEmail", validate: value => value.includes("@") ? null : "Invalid" });
  const Emails = arrayFieldModel(["initial@example.com"], { item: Email, name: "CollectionModelEmails" });
  const app = scope(), other = scope(), declarations: string[] = [];
  const [a, b, c] = withUnitDeclarationTracker(kind => declarations.push(kind), () => [
    scoped(app, () => Emails.create({ id: "a" })), scoped(app, () => Emails.create({ id: "b" })), scoped(other, () => Emails.create({ id: "a" })),
  ]);
  try {
    expect(declarations).toEqual([]);
    expect(a.field.items.value[0].state.node).toBe(b.field.items.value[0].state.node);
    expect(a.value.value).toEqual(["initial@example.com"]);
    await withUnitDeclarationTracker(kind => declarations.push(kind), () => a.field.push("new@example.com"));
    expect(declarations).toEqual([]);
    const added = a.field.items.value[1];
    expect(fieldModelSource(added)!.instance.alive).toBe(true);
    await a.field.move(1, 0);
    expect(a.field.items.value[0]).toBe(added);
    await a.field.remove(0);
    expect(fieldModelSource(added)!.instance.alive).toBe(false);
    expect(() => added.state.value).toThrow(/disposed/);
    await a.field.fill(["invalid"]); await a.field.validate();
    expect(a.field.errors.value).toEqual(["Invalid"]);
    expect(b.value.value).toEqual(["initial@example.com"]);
    expect(c.value.value).toEqual(["initial@example.com"]);
    await a.field.reset();
    expect(a.value.value).toEqual(["initial@example.com"]);
    await a.field.clear(); await a.field.reset();
    expect(a.value.value).toEqual(["initial@example.com"]);
  } finally { await a.dispose(); await b.dispose(); await c.dispose(); }
});

it("owns shape children, creates dynamic keys from a declared model and resets membership", async () => {
  const Text = fieldModel("initial", { name: "ShapeModelText" });
  const Details = shapeFieldModel({ name: Text, count: 1 }, { additional: Text, name: "ShapeModelDetails" });
  const [a, b] = scoped(scope(), () => Details.create([{}, {}]));
  try {
    expect(a.value.value).toEqual({ name: "initial", count: 1 });
    const count = a.field.fields.value.count;
    await a.field.remove("count");
    expect(fieldModelSource(count)!.instance.alive).toBe(false);
    const declarations: string[] = [];
    await withUnitDeclarationTracker(kind => declarations.push(kind), () => a.field.fill({ extra: "new" } as never));
    expect(declarations).toEqual([]);
    const extra = a.field.fields.value.extra;
    expect(extra.read!()).toBe("new");
    expect(b.value.value).toEqual({ name: "initial", count: 1 });
    await a.field.reset();
    expect(a.value.value).toEqual({ name: "initial", count: 1 });
    expect(fieldModelSource(extra)!.instance.alive).toBe(false);
    await a.field.clear();
    expect(a.value.value).toEqual({});
  } finally { await a.dispose(); await b.dispose(); }
});

it("borrows existing fields through refs, preserves duplicates and never adopts their owner", async () => {
  const Email = fieldModel("", { name: "BorrowedCollectionEmail" });
  const Emails = arrayFieldModel<string>([], { item: Email });
  const Details = shapeFieldModel({ email: Email });
  const Draft = staticModel({ data: { email: children.one(Email) }, onCreate(self) { if (!self.email.value) self.email.create({}); } });
  const app = scope(), draft = scoped(app, () => Draft.create({ email: { value: "shared" } })), email = draft.email.value!;
  const list = scoped(app, () => Emails.create({})), shape = scoped(app, () => Details.create({}));
  try {
    await list.field.push(email.field); await list.field.push(email.field);
    await shape.field.replace({ key: "email", field: email.field });
    expect(list.value.value).toEqual(["shared", "shared"]);
    await list.field.remove(0);
    expect(list.field.items.value).toEqual([email.field]);
    await shape.field.fields.value.email.fill("updated");
    expect(list.value.value).toEqual(["updated"]);
    await shape.dispose();
    expect(email.alive).toBe(true);
    await email.dispose();
    expect(list.value.value).toEqual([]);
  } finally { await list.dispose(); await shape.dispose(); await draft.dispose(); }
});

it("rejects fields from another application before changing collection membership", async () => {
  const Item = fieldModel(0), List = arrayFieldModel([1], { item: Item });
  const list = scoped(scope(), () => List.create({})), foreignList = scoped(scope(), () => List.create({}));
  const foreignField = foreignList.field.items.value[0], foreign = fieldModelSource(foreignField)!.instance;
  try {
    await expect(list.field.push(foreignField)).rejects.toThrow(/another application/);
    expect(list.value.value).toEqual([1]);
    expect(foreign.alive).toBe(true);
  } finally { await list.dispose(); await foreignList.dispose(); }
});

it("restores nested array/shape membership, order and reset baselines from DTO and snapshot", async () => {
  const Email = fieldModel("", { name: "NestedModelEmail" });
  const Tags = arrayFieldModel(["tag"], { name: "NestedModelTags" });
  const Contact = shapeFieldModel({ email: Email, tags: Tags }, { name: "NestedModelContact" });
  const Contacts = arrayFieldModel([{ email: "initial", tags: ["seed"] }], { item: Contact, name: "NestedModelContacts" });
  const Profile = staticModel({ name: "NestedModelProfile", data: { contacts: children.one(Contacts) },
    setup(self) { return { form: createForm({ schema: () => ({ contacts: self.contacts.value!.field }) }) }; },
    onCreate(self) { if (!self.contacts.value) self.contacts.create({}); },
  });
  const server = scope(), a = scoped(server, () => Profile.create({ id: "profile" }));
  await a.form.fill({ values: { contacts: [{ email: "edited", tags: ["a", "b"] }, { email: "second", tags: [] }] } });
  await a.contacts.value!.field.move(1, 0);
  const dto = JSON.parse(JSON.stringify(a.json())) as Record<string, unknown>, snapshot = JSON.parse(JSON.stringify(serialize(server)));
  const b = scoped(scope({ snapshot }), () => Profile.create(dto));
  try {
    expect(b.form.values.value).toEqual(a.form.values.value);
    await b.form.reset();
    expect(b.form.values.value).toEqual({ contacts: [{ email: "initial", tags: ["seed"] }] });
    expect(a.form.values.value.contacts[0].email).toBe("second");
    await a.contacts.value!.field.clear();
    const empty = scoped(scope(), () => Profile.create(JSON.parse(JSON.stringify(a.json())) as Record<string, unknown>));
    try { expect(empty.form.values.value).toEqual({ contacts: [] }); } finally { await empty.dispose(); }
  } finally { await a.dispose(); await b.dispose(); }
});

it("awaits removed children's asynchronous disposal and leaves borrowed fields live", async () => {
  const Item = fieldModel(0), List = arrayFieldModel([1], { item: Item });
  const list = scoped(scope(), () => List.create({}));
  const child = fieldModelSource(list.field.items.value[0])!.instance, gate = deferred<void>();
  modelInstanceBindingOf(child)!.beforeDispose(() => gate.promise);
  let done = false;
  const removal = list.field.remove(0).then(() => { done = true; });
  try {
    await Promise.resolve(); expect(done).toBe(false);
    gate.resolve(); await removal;
    expect(child.alive).toBe(false);
    expect(list.value.value).toEqual([]);
  } finally { gate.resolve(); await removal; await list.dispose(); }
});

it("keeps custom fieldType extensions on the shared scalar model graph", async () => {
  const Upper = fieldType({ create: (initial: string) => createField(initial) }).extend({
    create(base, initial: string) { const field = base(initial); return { ...field, uppercase: () => field.fill(field.read().toUpperCase()) }; },
  });
  const Text = fieldModel("initial", { create: initial => Upper(initial) });
  const [a, b] = scoped(scope(), () => Text.create([{}, {}]));
  try {
    await a.field.uppercase();
    expect(a.value.value).toBe("INITIAL");
    expect(b.value.value).toBe("initial");
  } finally { await a.dispose(); await b.dispose(); }
});

it("keeps independent module graphs separate from ordinary model instances", async () => {
  const List = arrayFieldModel([1], { name: "ModuleModelList" });
  const first = List.static(), second = List.static(), app = scope();
  const regular = scoped(app, () => List.create({}));
  try {
    await scoped(app, () => first.field.push(2));
    await scoped(app, () => second.field.push(3));
    await regular.field.push(4);
    expect(scoped(app, () => first.field.read())).toEqual([1, 2]);
    expect(scoped(app, () => second.field.read())).toEqual([1, 3]);
    expect(regular.value.value).toEqual([1, 4]);
  } finally { await scoped(app, () => first.dispose()); await scoped(app, () => second.dispose()); await regular.dispose(); }
});

it("runs the documented scalar, array, shape and custom fields through a model form", async () => {
  const declarations: string[] = [];
  const [a, b] = withUnitDeclarationTracker(kind => declarations.push(kind), () => scoped(scope(), () => DocumentedProfile.create([{}, {}])));
  try {
    expect(declarations).toEqual([]);
    await a.form.fill({ values: {
      email: "root@example.com", phones: ["123"],
      contact: { email: "contact@example.com", label: "  LABEL  ", phones: ["456"] },
      contacts: [{ email: "row@example.com", label: "row", phones: [] }],
    } });
    await a.contact.value!.field.fields.value.label.normalize();
    await a.form.validate();
    expect(a.form.isValid.value).toBe(true);
    expect(a.form.values.value.contact.label).toBe("label");
    expect(a.form.values.value.contacts[0].phones).toEqual([]);
    expect(b.form.values.value.email).toBe("");
    const child = a.phones.value!.field.items.value[0];
    await a.dispose();
    expect(fieldModelSource(child)!.instance.alive).toBe(false);
    expect(b.alive).toBe(true);
  } finally { await a.dispose(); await b.dispose(); }
});

it("revalidates model forms on direct and repeated collection-child writes", async () => {
  const List = arrayFieldModel([""]);
  const seen: string[] = [];
  const Model = staticModel({ data: { list: children.one(List) },
    setup(self) { return { form: createForm({ schema: () => ({ list: self.list.value!.field }),
      validation: values => { seen.push(JSON.stringify(values)); return null; }, validationStrategies: ["change"],
    }) }; }, onCreate(self) { self.list.create({}); },
  });
  const [a, b] = scoped(scope(), () => Model.create([{}, {}]));
  try {
    await a.list.value!.field.items.value[0].fill("first");
    await vi.waitFor(() => expect(seen.at(-1)).toBe('{"list":["first"]}'));
    const previous = seen.length;
    await a.list.value!.field.items.value[0].fill("first");
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(previous));
    await a.list.value!.field.fill(["second"]);
    await vi.waitFor(() => expect(seen.at(-1)).toBe('{"list":["second"]}'));
    expect(b.form.values.value).toEqual({ list: [""] });
    await vi.waitFor(() => expect(a.form.isValidationPending.value).toBe(false));
  } finally { await a.dispose(); await b.dispose(); }
});

it("round-trips owned membership through JSON DTO alone, without a scope snapshot", async () => {
  const Row = shapeFieldModel({ text: "" }, { name: "DtoOnlyRow" });
  const Rows = arrayFieldModel([{ text: "initial" }], { item: Row, name: "DtoOnlyRows" });
  const a = scoped(scope(), () => Rows.create({}));
  await a.field.push({ text: "new" }); await a.field.move(1, 0);
  const dto = JSON.parse(JSON.stringify(a.json())) as Record<string, unknown>;
  const b = scoped(scope(), () => Rows.create(dto));
  try { expect(b.value.value).toEqual(a.value.value); } finally { await a.dispose(); await b.dispose(); }
});
