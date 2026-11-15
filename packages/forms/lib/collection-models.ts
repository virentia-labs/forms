import { effect, getCurrentScope, scoped, type Effect, type Scope, type Store } from "@virentia/core";
import { modelInstanceBindingOf, modelScopeInstance, unwrapMicroScope } from "@virentia/core/internal";
import { children, f, isModelDefinition, refs, staticModel, trait, type AnyModel, type Field as DataField, type FieldStore, type InstanceApi, type InstanceOf, type RelationDef } from "@virentia/core/models";
import { createArrayField } from "./array-field";
import { createShapeField } from "./shape-field";
import { withArrayModelState, withShapeModelState } from "./collection-state";
import { fieldModel } from "./scalar-model";
import { fieldModelSource, fieldModelSpec, registerFieldModel, registerModelField, type FieldModelInstance } from "./model-field-binding";
import { cloneSnapshot } from "./shared";
import type { AnyField, ArrayField, CreateArrayFieldOptions, CreateShapeFieldOptions, Field, FieldValue, ShapeField } from "./types";

export type FieldModelDefinition = AnyModel & { readonly "~members"?: { field: AnyField } };
export type ModelField<M extends FieldModelDefinition> = InstanceOf<M> extends { field: infer F extends AnyField } ? F : never;
type Identity = { name?: string; sid?: string };
export type ArrayFieldModelOptions<Value, M extends FieldModelDefinition> =
  Omit<CreateArrayFieldOptions<Value, ModelField<M>>, "createItem"> & Identity & { item: M };
export type ShapeFieldModelOptions = Omit<CreateShapeFieldOptions, "createField"> & Identity & { additional?: FieldModelDefinition };
type ShapeFields<S extends Record<string, unknown>> = { [K in keyof S]: S[K] extends FieldModelDefinition ? ModelField<S[K]> : Field<S[K]> };
type Slot = { type: number; id: string };
type Entries = readonly Slot[] | Record<string, Slot>;
type Saved = { key: string; slot: Slot; owned: boolean; input: Record<string, unknown> };
interface Owned {
  readonly items: FieldModelInstance[];
  add(input: Record<string, unknown>): FieldModelInstance;
  remove(instance: FieldModelInstance): void | Promise<void>;
}
interface Links { readonly items: FieldModelInstance[]; add(instance: FieldModelInstance): void; remove(instance: FieldModelInstance): void }
interface Cells {
  _entries: FieldStore<Entries>;
  _ready: FieldStore<boolean>;
  _nextId: FieldStore<number>;
  _seed: FieldStore<unknown>;
  _baseline: FieldStore<readonly Saved[]>;
  _initialized: FieldStore<boolean>;
  _innerError: FieldStore<string | null>;
  _outerError: FieldStore<string | null>;
  _ownErrors: FieldStore<Record<string, unknown> | null>;
  _revision: FieldStore<number>;
}
type Self = InstanceApi & Cells & { readonly field: AnyField };
interface Catalog { definition: FieldModelDefinition; owned: string; links: string }
const collectionRuntime = Symbol("forms.collection.runtime");

export function arrayFieldModel<M extends FieldModelDefinition>(
  initial: readonly FieldValue<ModelField<M>>[], options: ArrayFieldModelOptions<FieldValue<ModelField<M>>, M>,
): ReturnType<typeof declareArray<FieldValue<ModelField<M>>, M>>;
export function arrayFieldModel<Value, M extends FieldModelDefinition = ReturnType<typeof fieldModel<Value>>>(
  initial: readonly (Value & FieldValue<ModelField<M>>)[], options: ArrayFieldModelOptions<Value, M>,
): ReturnType<typeof declareArray<Value, M>>;
export function arrayFieldModel<Value>(initial?: readonly Value[], options?: Omit<CreateArrayFieldOptions<Value>, "createItem"> & Identity): ReturnType<typeof declareArray<Value, ReturnType<typeof fieldModel<Value>>>>;
export function arrayFieldModel(initial: readonly unknown[] = [], options: Identity & { item?: FieldModelDefinition } & Omit<CreateArrayFieldOptions<unknown>, "createItem"> = {}) {
  return declareArray(initial, { ...options, item: options.item ?? fieldModel<unknown>(undefined, {
    name: options.name && `${options.name}.Item`, sid: options.sid && `${options.sid}/item`,
  }) });
}
function declareArray<Value, M extends FieldModelDefinition>(initial: readonly Value[], options: ArrayFieldModelOptions<Value, M>) {
  return declareCollection<ArrayField<Value, ModelField<M>>>([options.item], options, true,
    (self, runtime) => withArrayModelState({
      items: { get value() { return runtime.read() as AnyField[]; }, set value(value) { runtime.write(value); } },
      innerError: self._innerError, outerError: self._outerError, revision: self._revision,
      createItem: value => runtime.create(0, value), initialItems: () => runtime.reset() as Promise<AnyField[]>, commit: runtime.commit,
    }, () => createArrayField<Value, ModelField<M>>([], options)),
    runtime => (Array.isArray(runtime.seed) ? runtime.seed : initial).map(value => runtime.create(0, value)));
}

export function shapeFieldModel<S extends Record<string, unknown>>(schema: S, options: ShapeFieldModelOptions = {}) {
  const defaults = Object.entries(schema).map(([key, value]) => ({
    key, definition: isModelDefinition(value) ? value as FieldModelDefinition : fieldModel(value, {
      name: options.name && `${options.name}.${key}`, sid: options.sid && `${options.sid}/${key}`,
    }),
  }));
  const additional = options.additional ?? fieldModel<unknown>(undefined, {
    name: options.name && `${options.name}.Additional`, sid: options.sid && `${options.sid}/additional`,
  });
  const definitions = [...new Set([...defaults.map(item => item.definition), additional])];
  const types = new Map(defaults.map(item => [item.key, definitions.indexOf(item.definition)]));
  const fallback = definitions.indexOf(additional);
  type Result = ShapeField<ShapeFields<S>> & { readonly fields: Store<Readonly<ShapeFields<S>>> };
  return declareCollection<Result>(definitions, options, false,
    (self, runtime) => withShapeModelState({
      fields: { get value() { return runtime.read() as Record<string, AnyField>; }, set value(value) { runtime.write(value); } },
      ownErrors: self._ownErrors, revision: self._revision, commit: runtime.commit,
      createField: (key, value) => runtime.create(types.get(key) ?? fallback, value), initialFields: () => runtime.reset() as Promise<Record<string, AnyField>>,
    }, () => createShapeField({}, options) as Result),
    runtime => {
      const seed = runtime.seed && typeof runtime.seed === "object" ? runtime.seed as Record<string, unknown> : undefined;
      const result: Record<string, AnyField> = Object.create(null);
      for (const { key, definition } of defaults) result[key] = seed && Object.hasOwn(seed, key)
        ? runtime.create(types.get(key)!, seed[key]) : runtime.createDefault(definitions.indexOf(definition));
      if (seed) for (const [key, value] of Object.entries(seed)) if (!Object.hasOwn(result, key)) result[key] = runtime.create(fallback, value);
      return result;
    });
}

interface Runtime {
  readonly seed: unknown;
  read(): AnyField[] | Record<string, AnyField>;
  write(fields: readonly AnyField[] | Record<string, AnyField>): void;
  create(type: number, value: unknown): AnyField;
  createDefault(type: number): AnyField;
  reset: Effect<void, AnyField[] | Record<string, AnyField>>;
  commit: Effect<void, void>;
}
function declareCollection<F extends AnyField>(definitions: readonly FieldModelDefinition[], identity: Identity, array: boolean,
  build: (self: Self, runtime: Runtime) => F, defaults: (runtime: Runtime) => readonly AnyField[] | Record<string, AnyField>) {
  for (const definition of definitions) if (!fieldModelSpec(definition)) throw new Error("[forms] Collection items must use a field model definition");
  const catalog: Catalog[] = definitions.map((definition, i) => ({ definition, owned: `_owned${i}`, links: `_links${i}` }));
  const relations: Record<string, RelationDef> = {};
  for (const entry of catalog) { relations[entry.owned] = children.many(entry.definition); relations[entry.links] = refs.many(entry.definition).policy("nullify"); }
  const State = trait({ data: {
    _entries: f.any(array ? [] : {}) as DataField<Entries, null, true>,
    _ready: f.boolean(false), _nextId: f.number(0), _seed: f.any(null) as DataField<unknown, null, true>,
    _baseline: (f.any([]) as DataField<readonly Saved[], null, true>).local(), _initialized: f.boolean(false).local(),
    _innerError: f.union([f.string(), f.null()], null).local(), _outerError: f.union([f.string(), f.null()], null).local(),
    _ownErrors: (f.any(null) as DataField<Record<string, unknown> | null, null, true>).local(), _revision: f.number(0).local(),
  } });
  const runtimeFor = (self: Self): Runtime => {
    const pendingRemovals = new WeakMap<Scope, Map<FieldModelInstance, Promise<void>>>();
    // Only this internal dictionary uses dynamically declared relation keys.
    const relation = <T>(key: string) => (self as unknown as Record<string, unknown>)[key] as T;
    const owned = (type: number) => relation<Owned>(catalog[type].owned);
    const links = (type: number) => relation<Links>(catalog[type].links);
    const entries = () => Object.entries(self._entries.value) as [string, Slot][];
    const home = () => {
      const current = unwrapMicroScope(getCurrentScope()!);
      return (modelScopeInstance(current) as { homeScope: Scope } | undefined)?.homeScope ?? current;
    };
    const slotOf = (field: AnyField): Slot => {
      const source = fieldModelSource(field);
      if (!source || !source.instance.alive) throw new Error("[forms] Expected a live model field; declare it with a field model factory");
      const type = catalog.findIndex(item => item.definition === source.definition);
      if (type < 0) throw new Error("[forms] The field's definition is not declared in this collection (item/additional)");
      if (modelInstanceBindingOf(source.instance)?.homeScope !== home()) throw new Error("[forms] Cannot attach a field from another application scope");
      return { type, id: source.instance.id };
    };
    const read = () => {
      const lookup = catalog.map((_, type) => new Map(links(type).items.map(item => [item.id, item])));
      const result = entries().flatMap(([key, slot]) => { const item = lookup[slot.type].get(slot.id); return item ? [[key, item.field] as const] : []; });
      return array ? result.map(([, field]) => field) : Object.fromEntries(result);
    };
    const write = (fields: readonly AnyField[] | Record<string, AnyField>) => {
      const next = Object.entries(fields).map(([key, field]) => ({ key, field, slot: slotOf(field) }));
      for (let type = 0; type < catalog.length; type++) {
        const target = links(type), current = new Map(target.items.map(item => [item.id, item]));
        const selected = next.filter(item => item.slot.type === type), ids = new Set(selected.map(item => item.slot.id));
        for (const item of current.values()) if (!ids.has(item.id)) target.remove(item);
        for (const item of selected) if (!current.has(item.slot.id)) {
          const instance = fieldModelSource(item.field)!.instance;
          target.add(instance); current.set(instance.id, instance);
        }
      }
      self._entries.value = array ? next.map(item => item.slot) : Object.fromEntries(next.map(item => [item.key, item.slot]));
    };
    const create = (type: number, input: Record<string, unknown>) => {
      // Core omits temporary generated IDs from child DTOs. Membership refs
      // require wire identities, including without a transferred scope snapshot.
      const id = input.id ?? `forms:${self.key}:${type}:${self._nextId.value++}`;
      return owned(type).add({ ...input, id }).field;
    };
    const commit = effect<void, void>(async (_payload, { scope, signal }) => {
      const run = scoped(scope);
      const currentScope = unwrapMicroScope(scope);
      let previous: Entries | undefined, active = new Set<string>();
      const selected = (type: number, id: string) => run(() => {
        const current = self._entries.value;
        if (current !== previous) {
          previous = current;
          active = new Set(Object.values(current).map(slot => `${slot.type}:${slot.id}`));
        }
        return active.has(`${type}:${id}`);
      });
      for (let type = 0; type < catalog.length; type++) {
        if (signal.aborted) return;
        const collection = run(() => owned(type));
        for (const item of run(() => collection.items.slice())) {
          if (signal.aborted) return;
          // Another mutation may have completed while cleanup awaited. Its
          // selected children must not be collected using the previous entries.
          if (!item.alive || selected(type, item.id)) continue;
          let pending = pendingRemovals.get(currentScope);
          if (pending?.has(item)) continue;
          if (!pending) pendingRemovals.set(currentScope, pending = new Map());
          let resolve!: () => void, reject!: (error: unknown) => void;
          const completion = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
          pending.set(item, completion);
          const forget = () => {
            pending.delete(item);
            if (!pending.size) pendingRemovals.delete(currentScope);
          };
          // Register before calling user beforeDispose hooks: synchronous
          // re-entry must not attempt to remove the same child a second time.
          const done = () => { forget(); resolve(); };
          const failed = (error: unknown) => { forget(); reject(error); };
          try {
            const removal = run(() => collection.remove(item));
            if (removal) Promise.resolve(removal).then(done, failed);
            else done();
          } catch (error) { failed(error); }
          await completion;
        }
      }
    }, "field.collection.commit");
    const reset = effect<void, AnyField[] | Record<string, AnyField>>(async (_payload, { scope, signal }) => {
      const run = scoped(scope), currentScope = unwrapMicroScope(scope);
      // A removed original item may still own its ID during async cleanup.
      // Recreate baseline items only after those removals have finished.
      for (;;) {
        const pending = pendingRemovals.get(currentScope);
        if (!pending?.size) break;
        for (const removal of pending.values()) await removal;
        if (signal.aborted) return array ? [] : {};
      }
      return run(() => {
        const restored: Record<string, AnyField> = Object.create(null);
        const lookup = catalog.map((_, type) => new Map(owned(type).items.map(item => [item.id, item])));
        for (const saved of self._baseline.value) {
          let item: FieldModelInstance | null | undefined = lookup[saved.slot.type].get(saved.slot.id);
          if (!item && saved.owned) { item = owned(saved.slot.type).add(cloneSnapshot(saved.input)); lookup[saved.slot.type].set(item.id, item); }
          if (!item) item = scoped(home(), () => catalog[saved.slot.type].definition.get(saved.slot.id)) as FieldModelInstance | null;
          if (item?.alive) restored[saved.key] = item.field;
        }
        return array ? Object.values(restored) : restored;
      });
    }, "field.collection.reset");
    return {
      get seed() { return self._seed.value; }, read, write, commit, reset,
      create: (type, value) => create(type, fieldModelSpec(catalog[type].definition)!.input(value)), createDefault: type => create(type, {}),
    };
  };
  const Model = staticModel({
    name: identity.name, sid: identity.sid, with: [State], data: relations,
    setup(self) {
      const runtime = runtimeFor(self as unknown as Self);
      const field = build(self as unknown as Self, runtime);
      Object.defineProperty(field, collectionRuntime, { value: runtime });
      return { field, value: (field as unknown as { state: Store<FieldValue<F>> }).state };
    },
    onCreate(view) {
      const self = view as unknown as Self;
      const runtime = (self.field as unknown as { [collectionRuntime]: Runtime })[collectionRuntime];
      if (!self._ready.value) { runtime.write(defaults(runtime)); self._seed.value = null; self._ready.value = true; }
      if (!self._initialized.value) {
        const dictionary = self as unknown as Record<string, unknown>;
        const lookup = catalog.map(entry => new Map((dictionary[entry.links] as Links).items.map(item => [item.id, item])));
        const owned = catalog.map(entry => new Set((dictionary[entry.owned] as Owned).items.map(item => item.id)));
        self._baseline.value = Object.entries(self._entries.value).flatMap(([key, slot]) => {
          const item = lookup[slot.type].get(slot.id);
          return item ? [{ key, slot, owned: owned[slot.type].has(item.id), input: cloneSnapshot(item.json()) }] : [];
        });
        self._initialized.value = true;
      }
      registerModelField(Model, view as unknown as FieldModelInstance);
    },
  });
  registerFieldModel(Model, { input: value => ({ _seed: value }) });
  return Model;
}
