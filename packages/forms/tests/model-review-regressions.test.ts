import { scope, scoped, serialize } from "@virentia/core";
import { modelInstanceBindingOf, withUnitDeclarationTracker } from "@virentia/core/internal";
import { children, staticModel } from "@virentia/core/models";
import { expect, it, vi } from "vitest";
import { createField, createForm, fieldType, type CreateFieldOptions } from "../lib";
import { arrayFieldModel, fieldModel, shapeFieldModel } from "../lib/models";
import { fieldModelSource } from "../lib/model-field-binding";
import { deferred } from "./_helpers";

it("runs shape-level validation and change strategy through an owned form", async () => {
  const validate = vi.fn((values: Record<string, unknown>) => values.name ? null : { name: "Required" });
  const Details = shapeFieldModel({ name: "" }, { validate, validationStrategies: ["change"] });
  const Profile = staticModel({
    data: { details: children.one(Details) },
    setup(self) { return { form: createForm({ schema: () => ({ details: self.details.value!.field }) }) }; },
    onCreate(self) { self.details.create({}); },
  });
  const [a, b] = scoped(scope(), () => Profile.create([{}, {}]));
  try {
    await a.details.value!.field.validate();
    expect(a.details.value!.field.errors.value).toEqual({ name: "Required" });
    expect(a.details.value!.field.isValid.value).toBe(false);
    expect(validate).toHaveBeenCalledWith({ name: "" }, expect.anything());
    await a.details.value!.field.fill({ name: "Ada" });
    expect(a.details.value!.field.isValid.value).toBe(true);
    expect(validate).toHaveBeenCalledWith({ name: "Ada" }, expect.anything());
    await b.form.validate();
    expect(b.form.errors.value).toEqual({ details: { name: "Required" } });
    expect(a.form.values.value.details.name).toBe("Ada");
    expect(b.form.isValid.value).toBe(false);
  } finally { await a.dispose(); await b.dispose(); }
});

type Meta = { label: string };
function customText() {
  return fieldType({
    create: (initial: string, options?: CreateFieldOptions<string, Meta>) => createField(initial.trim(), {
      ...options, meta: options?.meta ?? { label: "factory" }, error: options?.error ?? "preset",
    }),
  }).extend({
    create(base, initial: string, options?: CreateFieldOptions<string, Meta>) {
      const field = base(initial, options);
      return { ...field, uppercase: () => field.fill(field.read().toUpperCase()) };
    },
  });
}

it("preserves custom factory defaults and explicit DTO values without declaring units per child", async () => {
  const TextType = customText();
  const Text = fieldModel<string, Meta, ReturnType<typeof TextType>>("  Ada  ", {
    create: (initial, options) => TextType(initial, options),
  });
  const Parent = staticModel({ data: { text: children.one(Text) }, onCreate(self) { if (!self.text.value) self.text.create({}); } });
  const declarations: string[] = [], app = scope();
  const [a, b] = withUnitDeclarationTracker(kind => declarations.push(kind), () => scoped(app, () => Parent.create([
    { id: "default" }, { id: "dto", text: { value: "  explicit  " } },
  ])));
  try {
    expect(declarations).toEqual([]);
    expect(a.text.value!.field.read()).toBe("Ada");
    expect(a.text.value!.field.meta.value).toEqual({ label: "factory" });
    expect(a.text.value!.field.error.value).toBe("preset");
    await a.text.value!.field.uppercase();
    await a.text.value!.field.changeMeta({ label: "changed" });
    await a.text.value!.field.setOuterErrors("changed");
    await a.text.value!.field.reset();
    expect(a.text.value!.field.read()).toBe("Ada");
    expect(a.text.value!.field.meta.value).toEqual({ label: "factory" });
    expect(a.text.value!.field.error.value).toBe("preset");
    expect(b.text.value!.field.read()).toBe("  explicit  ");
    await b.text.value!.field.fill("changed"); await b.text.value!.field.reset();
    expect(b.text.value!.field.read()).toBe("  explicit  ");
  } finally { await a.dispose(); await b.dispose(); }
});

it("keeps custom defaults under hydrated metadata and the original reset baseline", async () => {
  const TextType = customText();
  const Text = fieldModel<string, Meta, ReturnType<typeof TextType>>("  Ada  ", {
    name: "ReviewSnapshotText", create: (initial, options) => TextType(initial, options),
  });
  const Parent = staticModel({ name: "ReviewSnapshotParent", data: { text: children.one(Text) },
    onCreate(self) { if (!self.text.value) self.text.create({}); },
  });
  const server = scope(), original = scoped(server, () => Parent.create({ id: "parent" }));
  await original.text.value!.field.fill("saved");
  await original.text.value!.field.changeMeta({ label: "saved" });
  await original.text.value!.field.setOuterErrors("backend");
  await original.text.value!.field.focus();
  const payload = { dto: original.json(), snapshot: serialize(server) };
  const received = JSON.parse(JSON.stringify(payload)) as typeof payload;
  const restored = scoped(scope({ snapshot: received.snapshot }), () => Parent.create(received.dto));
  try {
    expect(restored.text.value!.field.read()).toBe("saved");
    expect(restored.text.value!.field.meta.value).toEqual({ label: "saved" });
    expect(restored.text.value!.field.error.value).toBe("backend");
    expect(restored.text.value!.field.isFocused.value).toBe(true);
    await restored.text.value!.field.reset();
    expect(restored.text.value!.field.read()).toBe("Ada");
    expect(restored.text.value!.field.meta.value).toEqual({ label: "factory" });
    expect(restored.text.value!.field.error.value).toBe("preset");
    expect(original.text.value!.field.read()).toBe("saved");
  } finally { await original.dispose(); await restored.dispose(); }
});

it("keeps captured factory defaults separate for each static module graph", async () => {
  let setups = 0;
  const Text = fieldModel("seed", { create(initial) { return createField(`${initial}:${++setups}`); } });
  const first = Text.static(), second = Text.static(), app = scope();
  const regular = scoped(app, () => Text.create({}));
  try {
    expect(setups).toBe(3);
    expect(regular.field.read()).toBe("seed:1");
    expect(scoped(app, () => first.field.read())).toBe("seed:2");
    expect(scoped(app, () => second.field.read())).toBe("seed:3");
    await regular.field.fill("changed"); await regular.field.reset();
    expect(regular.field.read()).toBe("seed:1");
  } finally {
    await regular.dispose(); await scoped(app, () => first.dispose()); await scoped(app, () => second.dispose());
  }
});

it("preserves a new shape member while another type awaits async disposal", async () => {
  const A = fieldModel("a"), B = fieldModel("b");
  const Shape = shapeFieldModel({ a: A, b: B }, { additional: B });
  const shape = scoped(scope(), () => Shape.create({}));
  const a = fieldModelSource(shape.field.fields.value.a)!.instance, gate = deferred<void>();
  let entered = false;
  modelInstanceBindingOf(a)!.beforeDispose(() => { entered = true; return gate.promise; });
  const removing = shape.field.remove("a");
  await vi.waitFor(() => expect(entered).toBe(true));
  const adding = shape.field.fill({ extra: "new" } as never);
  const completion = Promise.allSettled([removing, adding]);
  try {
    await expect(adding).resolves.toBeUndefined();
    const added = fieldModelSource(shape.field.fields.value.extra!)!.instance;
    expect(shape.value.value).toEqual({ b: "b", extra: "new" });
    gate.resolve(); await removing;
    expect(added.alive).toBe(true);
    expect(a.alive).toBe(false);
    expect(shape.value.value).toEqual({ b: "b", extra: "new" });
  } finally { gate.resolve(); await completion; await shape.dispose(); }
});

it("waits for an already removed baseline item before resetting an array", async () => {
  const Item = fieldModel(0), Items = arrayFieldModel([1, 2], { item: Item });
  const list = scoped(scope(), () => Items.create({}));
  const first = fieldModelSource(list.field.items.value[0]!)!.instance, gate = deferred<void>();
  let entered = false;
  modelInstanceBindingOf(first)!.beforeDispose(() => { entered = true; return gate.promise; });
  const removing = list.field.remove(0);
  await vi.waitFor(() => expect(entered).toBe(true));
  const pushed = list.field.push(3);
  const added = list.field.items.value.at(-1)!;
  let resetDone = false;
  const resetting = list.field.reset().then(() => { resetDone = true; });
  const completion = Promise.allSettled([removing, pushed, resetting]);
  try {
    await expect(pushed).resolves.toBeUndefined();
    expect(resetDone).toBe(false);
    gate.resolve();
    await Promise.all([removing, resetting]);
    expect(first.alive).toBe(false);
    expect(list.value.value).toEqual([1, 2]);
    expect(fieldModelSource(added)!.instance.alive).toBe(false);
  } finally { gate.resolve(); await completion; await list.dispose(); }
});

it("propagates a cleanup failure and allows a later reset to recover the member", async () => {
  const Item = fieldModel(1), List = arrayFieldModel([1], { item: Item });
  const list = scoped(scope(), () => List.create({}));
  const child = fieldModelSource(list.field.items.value[0]!)!.instance;
  const failure = new Error("cleanup failed");
  const unregister = modelInstanceBindingOf(child)!.beforeDispose(() => Promise.reject(failure));
  try {
    await expect(list.field.remove(0)).rejects.toMatchObject({ errors: [failure] });
    unregister();
    await list.field.reset();
    expect(list.value.value).toEqual([1]);
    expect(fieldModelSource(list.field.items.value[0]!)!.instance.alive).toBe(true);
  } finally { unregister(); await list.dispose(); }
});
