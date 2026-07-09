import {
  effect as virentiaEffect,
  event as virentiaEvent,
  getCurrentScope,
  owner,
  reaction,
  scope as createScope,
  scoped,
  type Store as VirentiaStore,
} from "@virentia/core";
import { fool } from "@virentia/effector";
import { normalizeField, readStoreSnapshot } from "@virentia/forms";
import type { AnyField } from "@virentia/forms";
import {
  createEvent,
  is as effectorIs,
  sample,
  type EventCallable as EffectorEventCallable,
} from "effector";
import type { AnyVirentiaUnit } from "./types";

/* ------------------------------------------------------------------ *
 * Unit detection & leaf actions
 * ------------------------------------------------------------------ */

/** Mirrors `@virentia/effector`'s internal `isVirentiaUnit`. */
function isVirentiaUnit(value: unknown): value is AnyVirentiaUnit {
  return Boolean(
    value &&
      (typeof value === "object" || typeof value === "function") &&
      "node" in (value as object) &&
      !effectorIs.unit(value as never),
  );
}

/**
 * A virentia store is a non-callable unit; events/effects are callable. Only
 * callable units can be a `target`. Non-units (plain methods like `read`,
 * `serialize`, or `kind`) return `null` and drop out of the lens.
 */
function classifyUnit(value: unknown): "targetable" | "watchable" | null {
  if (!isVirentiaUnit(value)) {
    return null;
  }
  return typeof value === "function" ? "targetable" : "watchable";
}

/** Wrap a virentia unit into the effector event fired on its updates. */
function clockOf(unit: AnyVirentiaUnit) {
  return fool(unit as never);
}

/**
 * Build a targetable action: fooling the unit yields an effector event-callable
 * that dispatches into virentia. An optional `map` is spliced in through a
 * `sample`, so callers can adapt external props to the unit's payload.
 */
function targetOf(unit: AnyVirentiaUnit) {
  return (map?: (props: any) => any): EffectorEventCallable<any> => {
    const fooled = fool(unit as never) as unknown as EffectorEventCallable<any>;
    if (!map) {
      return fooled;
    }
    const proxy = createEvent<any>();
    sample({ clock: proxy, fn: map, target: fooled });
    return proxy;
  };
}

function unitActions(unit: AnyVirentiaUnit, kind: "targetable" | "watchable") {
  const actions: Record<string, unknown> = { clock: () => clockOf(unit) };
  if (kind === "targetable") {
    actions.target = targetOf(unit);
  }
  return actions;
}

/* ------------------------------------------------------------------ *
 * Field / group lenses (single instance — no ids/where)
 * ------------------------------------------------------------------ */

/** A field lens is the field's units, each mapped to its watch/target actions. */
function createFieldLens(field: AnyField): Record<string, unknown> {
  const lens: Record<string, unknown> = {};
  const record = field as unknown as Record<string, unknown>;
  for (const key of Reflect.ownKeys(field)) {
    if (typeof key !== "string") {
      continue;
    }
    const kind = classifyUnit(record[key]);
    if (!kind) {
      continue;
    }
    lens[key] = unitActions(record[key] as AnyVirentiaUnit, kind);
  }
  return lens;
}

function isFieldNode(value: unknown): value is AnyField {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { kind?: unknown }).kind === "string" &&
      typeof (value as { fill?: unknown }).fill === "function",
  );
}

/**
 * Project a normalized schema node into its lens:
 * - array field -> collection lens keyed by stable item id
 * - shape field -> collection lens keyed by child key
 * - leaf field  -> the field's unit actions
 * - plain group -> recursion per key
 */
export function createSchemaLens(node: unknown): unknown {
  if (isFieldNode(node)) {
    const kind = (node as { kind: string }).kind;
    if (kind === "array") {
      return createArrayLens(node as AnyField & { items: VirentiaStore<readonly AnyField[]> });
    }
    if (kind === "shape") {
      return createShapeLens(node as AnyField & { fields: VirentiaStore<Record<string, AnyField>> });
    }
    return createFieldLens(node);
  }
  if (node && typeof node === "object") {
    const group: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      group[key] = createSchemaLens(child);
    }
    return group;
  }
  return {};
}

/* ------------------------------------------------------------------ *
 * Stable ids for array items
 * ------------------------------------------------------------------ */

/**
 * Assigns a stable id to each item field the first time it is seen and keeps it
 * across `move`/`swap`/`remove` (virentia preserves the item instances, so a
 * WeakMap keyed by the instance survives reordering). New items get fresh ids.
 */
function createIdRegistry() {
  const ids = new WeakMap<object, string>();
  let counter = 0;
  return {
    idOf(field: AnyField): string {
      let id = ids.get(field);
      if (id === undefined) {
        id = String(counter++);
        ids.set(field, id);
      }
      return id;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Collection lens (array & shape fields)
 * ------------------------------------------------------------------ */

type Predicate = (data: Record<string, unknown> & { id: string }, props: unknown) => boolean;

interface CollectionConfig {
  /** Read the current id -> item-field map. Reads in the ambient scope. */
  readEntries(read: <T>(store: VirentiaStore<T>) => T): Array<[string, AnyField]>;
  /** Event fired when membership changes, used to re-subscribe `clock()`. */
  readonly changed: AnyVirentiaUnit;
  /** Remove matched instances (called in the virentia scope). */
  remove(read: <T>(store: VirentiaStore<T>) => T, ids: string[]): Promise<void>;
  predicates: Predicate[];
  single: "first" | "last" | "one" | null;
  props: unknown;
}

function readItemData(field: AnyField, read: <T>(store: VirentiaStore<T>) => T, id: string) {
  const normalized = normalizeField(field);
  const value = read(normalized.state);
  const base = value && typeof value === "object" ? (value as Record<string, unknown>) : { value };
  return { ...base, id };
}

/** Resolve the matched entries by applying the accumulated selection operators. */
function resolveMatched(
  config: CollectionConfig,
  read: <T>(store: VirentiaStore<T>) => T,
): Array<[string, AnyField]> {
  let entries = config.readEntries(read);
  for (const predicate of config.predicates) {
    entries = entries.filter(([id, field]) => predicate(readItemData(field, read, id), config.props));
  }
  if (config.single === "first") {
    entries = entries.slice(0, 1);
  } else if (config.single === "last") {
    entries = entries.slice(-1);
  } else if (config.single === "one") {
    entries = entries.length === 1 ? entries : [];
  }
  return entries;
}

/** Read a virentia store outside any ambient scope (base value). */
function readBase<T>(store: VirentiaStore<T>): T {
  return scoped(createScope(), () => readStoreSnapshot(store));
}

/**
 * Read a store in the current ambient scope when there is one (e.g. inside
 * `scoped(...)`/`drive(...)` or a fooled virentia effect running in the
 * associated scope), otherwise fall back to its base value. Reading through a
 * fresh throwaway scope (`readBase`) always yields the initial value, so
 * scoped-side reads (`getSource()` under `drive`) would never see later
 * mutations; this keeps them current without throwing when no scope is active.
 */
function readCurrent<T>(store: VirentiaStore<T>): T {
  return getCurrentScope() ? readStoreSnapshot(store) : readBase(store);
}

/** Navigate a lens path (child-field keys, then a terminal unit) on one item. */
function resolveLeafUnit(item: AnyField, path: string[]): AnyVirentiaUnit | null {
  let field: AnyField = item;
  for (let i = 0; i < path.length - 1; i += 1) {
    const child = childField(field, path[i]!);
    if (!child) {
      return null;
    }
    field = child;
  }
  const last = path[path.length - 1]!;
  const unit = (field as unknown as Record<string, unknown>)[last];
  return isVirentiaUnit(unit) ? unit : null;
}

function childField(field: AnyField, key: string): AnyField | null {
  const fields = field.readFields?.();
  if (fields && key in fields) {
    return fields[key] ?? null;
  }
  const direct = (field as unknown as Record<string, unknown>)[key];
  return isFieldNode(direct) ? direct : null;
}

function callUnit(unit: AnyVirentiaUnit, value: unknown): unknown {
  return (unit as unknown as (payload: unknown) => unknown)(value);
}

/**
 * Terminal `target(map?)`: dispatches to every matched instance. The dispatch
 * runs inside a fooled virentia effect, so reads (`items`) and child unit calls
 * all happen in the associated virentia scope.
 */
function collectionTarget(config: CollectionConfig, path: string[]) {
  return (map?: (props: any) => any): EffectorEventCallable<any> => {
    const dispatch = virentiaEffect<unknown, void>(async (payload: unknown) => {
      const value = map ? map(payload) : payload;
      const matched = resolveMatched(config, readStoreSnapshot);
      await Promise.all(
        matched.map(([, item]) => {
          const unit = resolveLeafUnit(item, path);
          return unit ? Promise.resolve(callUnit(unit, value)) : Promise.resolve();
        }),
      );
    });
    return fool(dispatch) as unknown as EffectorEventCallable<any>;
  };
}

/**
 * Terminal `clock()`: fires when any matched instance's leaf unit updates. A
 * re-subscribing reaction rebinds when membership changes, so items pushed later
 * are picked up. Subscriptions are declared eagerly for the initial members.
 */
function collectionClock(config: CollectionConfig, path: string[]) {
  return () => {
    const out = virentiaEvent<unknown>();
    const subscribe = (read: <T>(store: VirentiaStore<T>) => T): Array<() => void> => {
      const disposers: Array<() => void> = [];
      for (const [, item] of resolveMatched(config, read)) {
        const unit = resolveLeafUnit(item, path);
        if (!unit) {
          continue;
        }
        const dispose = owner((disposeOwner) => {
          reaction({ on: unit as never, run: (value: unknown) => out(value) });
          return disposeOwner;
        });
        disposers.push(dispose);
      }
      return disposers;
    };

    let disposers = subscribe(readCurrent);
    reaction({
      on: config.changed,
      run() {
        for (const dispose of disposers) {
          dispose();
        }
        disposers = subscribe(readStoreSnapshot);
      },
    });

    return fool(out);
  };
}

/** Keys that would make the lens masquerade as a promise/thenable. */
function isThenableTrap(key: string): boolean {
  return key === "then" || key === "catch" || key === "finally";
}

/** Build the recursive, proxy-backed collection lens for a config + path. */
function buildCollectionLens(config: CollectionConfig, path: string[]): unknown {
  const ops: Record<string, unknown> = {
    getSource() {
      return Object.fromEntries(resolveMatched(config, readCurrent));
    },
    ids(...ids: string[]) {
      const set = new Set(ids);
      return buildCollectionLens(
        { ...config, predicates: [...config.predicates, (data) => set.has(data.id)] },
        path,
      );
    },
    where(predicate: Predicate) {
      return buildCollectionLens(
        { ...config, predicates: [...config.predicates, predicate] },
        path,
      );
    },
    first() {
      return buildCollectionLens({ ...config, single: "first" }, path);
    },
    last() {
      return buildCollectionLens({ ...config, single: "last" }, path);
    },
    single() {
      return buildCollectionLens({ ...config, single: "one" }, path);
    },
    props() {
      return buildCollectionLens(config, path);
    },
    delete() {
      const dispatch = virentiaEffect<void, void>(async () => {
        const matched = resolveMatched(config, readStoreSnapshot);
        await config.remove(
          readStoreSnapshot,
          matched.map(([id]) => id),
        );
      });
      return fool(dispatch) as unknown as EffectorEventCallable<void>;
    },
    clock: collectionClock(config, path),
    target: collectionTarget(config, path),
  };

  return new Proxy(ops, {
    get(target, key) {
      if (typeof key !== "string") {
        return Reflect.get(target, key);
      }
      // The lens is not a promise. If we navigated `then`/`catch`/`finally` into
      // a sub-lens, returning that (truthy) sub-lens would make the lens look
      // thenable — `scoped()`/`await` inspect `then`, so returning a lens from a
      // scoped block would wrap it in a Promise. Refuse those keys outright.
      if (isThenableTrap(key)) {
        return undefined;
      }
      // Selection operators and terminals live directly on `ops`; at the root of
      // the path `clock`/`target` are not yet meaningful, so only expose them
      // once a leaf has been navigated to.
      if (key in target) {
        if ((key === "clock" || key === "target") && path.length === 0) {
          return undefined;
        }
        return Reflect.get(target, key);
      }
      // Otherwise treat the key as navigation into the item field's shape.
      return buildCollectionLens(config, [...path, key]);
    },
    has(target, key) {
      if (typeof key === "string") {
        return isThenableTrap(key) ? false : true;
      }
      return Reflect.has(target, key);
    },
  });
}

function createArrayLens(field: AnyField & { items: VirentiaStore<readonly AnyField[]> }): unknown {
  const registry = createIdRegistry();
  const normalized = normalizeField(field);
  const config: CollectionConfig = {
    readEntries(read) {
      const items = read(field.items) ?? [];
      return items.map((item) => [registry.idOf(item), item] as [string, AnyField]);
    },
    changed: normalized.changed as AnyVirentiaUnit,
    async remove(read, ids) {
      const items = read(field.items) ?? [];
      const targetSet = new Set(ids);
      // Remove from the end so shifting indices stay valid.
      const indices = items
        .map((item, index) => [registry.idOf(item), index] as [string, number])
        .filter(([id]) => targetSet.has(id))
        .map(([, index]) => index)
        .sort((a, b) => b - a);
      const remove = (field as { remove?: (index: number) => Promise<void> }).remove;
      if (remove) {
        for (const index of indices) {
          await remove(index);
        }
      }
    },
    predicates: [],
    single: null,
    props: undefined,
  };
  return buildCollectionLens(config, []);
}

function createShapeLens(field: AnyField & { fields: VirentiaStore<Record<string, AnyField>> }): unknown {
  const normalized = normalizeField(field);
  const config: CollectionConfig = {
    readEntries(read) {
      const fields = read(field.fields) ?? {};
      return Object.entries(fields);
    },
    changed: normalized.changed as AnyVirentiaUnit,
    async remove(read, ids) {
      const remove = (field as { remove?: (key: string) => Promise<void> }).remove;
      if (remove) {
        for (const id of ids) {
          await remove(id);
        }
      }
    },
    predicates: [],
    single: null,
    props: undefined,
  };
  return buildCollectionLens(config, []);
}
