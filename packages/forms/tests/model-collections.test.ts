import { effect, reaction, scope, scoped, serialize, store } from "@virentia/core";
import { withUnitDeclarationTracker } from "@virentia/core/internal";
import { children, staticModel } from "@virentia/core/models";
import { expect, it } from "vitest";
import { createArrayField, createField, createForm, createShapeField, type Field } from "../lib";
import { fieldModel } from "../lib/models";
import { normalizeField } from "../lib/shared";

it("exposes array items as instance-bound fields, including newly created items", async () => {
  const Row = staticModel({ setup() {
    const tags = createArrayField(["initial"]);
    return { tags, form: createForm({ schema: { tags } }) };
  } });
  const [a, b] = scoped(scope(), () => Row.create([{}, {}]));
  try {
    const first = a.tags.items.value[0];
    expect(a.tags.items.value[0]).toBe(first);
    expect(a.tags.fields!.value["0"]).toBe(first);
    await first.fill("a");
    expect(a.form.values.value).toEqual({ tags: ["a"] });
    expect(b.form.values.value).toEqual({ tags: ["initial"] });
    await a.tags.push("new");
    const second = a.tags.items.value[1];
    await second.fill("changed");
    expect(a.tags.state.value).toEqual(["a", "changed"]);
    await a.tags.move(1, 0);
    expect(a.tags.items.value[0]).toBe(second);
    await a.tags.reset();
    expect(a.tags.state.value).toEqual(["initial"]);
    const saved = a.tags.items.value[0];
    await a.dispose();
    expect(() => saved.state.value).toThrow(/disposed/);
  } finally { await a.dispose(); await b.dispose(); }
});

it("shares collection graphs and binds their handles without declaring instance units", async () => {
  const Row = staticModel({ setup() { return {
    tags: createArrayField(["a", "b"]),
    details: createShapeField({ name: createField("x") }),
  }; } });
  const declarations: string[] = [];
  const [a, b] = withUnitDeclarationTracker(kind => declarations.push(kind), () => scoped(scope(), () => {
    const rows = Row.create([{}, {}]);
    for (const row of rows) {
      row.tags.items.value[0].read(); row.tags.itemFields.value["1"].read();
      row.details.fields.value.name.read!();
    }
    return rows;
  }));
  try {
    expect(declarations).toEqual([]);
    expect(a.tags.items.value[0].state.node).toBe(b.tags.items.value[0].state.node);
    expect(a.tags.items.value[0]).not.toBe(b.tags.items.value[0]);
  } finally { await a.dispose(); await b.dispose(); }
});

it("preserves the owner of a borrowed model field after collection removal and disposal", async () => {
  const Email = fieldModel("");
  const Draft = staticModel({ data: { email: children.one(Email) }, onCreate(self) { self.email.create({}); } });
  const Editor = staticModel({ setup() { return { tags: createArrayField<string>([]) }; } });
  const app = scope(), draft = scoped(app, () => Draft.create({})), editor = scoped(app, () => Editor.create({}));
  const email = draft.email.value!;
  try {
    await editor.tags.push(email.field);
    expect(editor.tags.items.value[0]).toBe(email.field);
    await editor.tags.items.value[0].fill("shared");
    await editor.tags.remove(0);
    await editor.dispose();
    expect(email.alive).toBe(true);
    expect(email.field.read()).toBe("shared");
  } finally { await editor.dispose(); await draft.dispose(); }
});

it("emits bound item handles from the shared computed, only for the watched model", async () => {
  const Row = staticModel({ setup() { return { tags: createArrayField(["initial"]) }; } });
  const [a, b] = scoped(scope(), () => Row.create([{}, {}]));
  const seen: string[][] = [];
  const watcher = reaction({ on: a.tags.items, run(items) { seen.push(items.map(field => field.read())); } });
  try {
    await b.tags.push("b");
    expect(seen).toEqual([]);
    await a.tags.push("a");
    expect(seen).toEqual([["initial", "a"]]);
    expect(a.tags.items.value[1].read()).toBe("a");
  } finally { watcher.stop(); await a.dispose(); await b.dispose(); }
});

it("restores initial collection field values and keeps request scopes independent", async () => {
  const Email = fieldModel("initial", { name: "CollectionSnapshotEmail" });
  const Row = staticModel({ name: "CollectionSnapshot", data: { email: children.one(Email) },
    setup() { return { tags: createArrayField<string>([]), details: createShapeField({}) }; },
    onCreate(self) { if (!self.email.value) self.email.create({}); },
  });
  const server = scope(), a = scoped(server, () => Row.create({ id: "row" }));
  await a.tags.push(a.email.value!.field);
  await a.details.add({ key: "email", field: a.email.value!.field });
  await a.tags.items.value[0].fill("server");
  const snapshot = JSON.parse(JSON.stringify(serialize(server)));
  const b = scoped(scope({ snapshot }), () => Row.create(a.json()));
  // Membership is runtime state here. Restore it explicitly from the model's
  // owned DTO; anonymous setup stores are not serialized data fields.
  await b.tags.push(b.email.value!.field);
  await b.details.add({ key: "email", field: b.email.value!.field });
  try {
    expect(b.tags.items.value[0].read()).toBe("server");
    expect(b.details.fields.value.email.read!()).toBe("server");
    await b.tags.items.value[0].fill("client");
    expect(a.tags.items.value[0].read()).toBe("server");
    await b.details.fields.value.email.reset();
    expect(b.tags.state.value).toEqual(["initial"]);
  } finally { await a.dispose(); await b.dispose(); }
});

it("exposes shape children as instance-bound fields after add, fill and reset", async () => {
  const Row = staticModel({ setup() {
    const details = createShapeField<Record<string, Field<string>>>({ name: createField("initial") });
    return { details, form: createForm({ schema: { details } }) };
  } });
  const [a, b] = scoped(scope(), () => Row.create([{}, {}]));
  try {
    const name = a.details.fields.value.name;
    expect(a.details.readFields().name).toBe(name);
    await name.fill("a");
    expect(a.form.values.value).toEqual({ details: { name: "a" } });
    expect(b.form.values.value).toEqual({ details: { name: "initial" } });
    await a.details.fill({ extra: "new" } as never);
    const extra = a.details.fields.value.extra!;
    await extra.fill("changed");
    expect(a.details.state.value).toEqual({ name: "a", extra: "changed" });
    await a.details.reset();
    expect(a.details.fields.value.name).toBe(name);
    expect(a.details.state.value).toEqual({ name: "initial" });
  } finally { await a.dispose(); await b.dispose(); }
});

it("creates dynamic owned field models through createItem without new unit declarations", async () => {
  const Phone = fieldModel("");
  const Draft = staticModel({
    data: { phones: children.many(Phone) },
    setup(self) { return { list: createArrayField<string>([], {
      createItem: value => self.phones.add({ value }).field,
    }) }; },
  });
  const draft = scoped(scope(), () => Draft.create({})), declarations: string[] = [];
  try {
    await withUnitDeclarationTracker(kind => declarations.push(kind), () => draft.list.push("123"));
    const phone = draft.phones.items[0];
    expect(draft.list.items.value[0]).toBe(phone.field);
    expect(declarations).toEqual([]);
    await draft.list.items.value[0].fill("456");
    expect(phone.value.value).toBe("456");
    await draft.list.remove(0);
    expect(phone.alive).toBe(true); // membership and ownership are independent
    await draft.phones.remove(phone);
    expect(phone.alive).toBe(false);
  } finally { await draft.dispose(); }
});

it("preserves custom item identity, prototypes and private members", async () => {
  class CustomField {
    readonly kind = "custom";
    readonly state = store(0);
    readonly node = this.state.node;
    readonly subscribe = this.state.subscribe;
    readonly fill = effect<number, void>(value => { this.state.value = value; });
    readonly reset = effect<void, void>(() => { this.state.value = 0; });
    #caption = "custom";
    caption() { return this.#caption; }
    read() { return this.state.value; }
  }
  let original!: CustomField;
  const Row = staticModel({ setup() {
    const field = original = new CustomField();
    normalizeField(field);
    return { list: createArrayField([0], { createItem: () => field }) };
  } });
  const row = scoped(scope(), () => Row.create({}));
  try {
    expect(row.list.items.value[0]).toBe(original);
    expect(row.list.items.value[0].caption()).toBe("custom");
    await row.list.fill([2]);
    expect(row.list.state.value).toEqual([2]);
  } finally { await row.dispose(); }
});
