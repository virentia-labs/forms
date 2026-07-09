import { describe, expect, it } from "vitest";
import {
  effect,
  event,
  getCurrentScope,
  scope,
  scoped,
  store,
} from "@virentia/core";
import {
  createField,
  createForm,
  defineField,
  fieldType,
  readStoreSnapshot,
} from "../lib";
import { tick } from "./_helpers";

// --- local helpers -----------------------------------------------------------

// Reads the inspector-assigned name off a virentia unit's graph node. Wrapped
// methods are effects named `${kind}.${key}`, and this is the only public-ish
// way to observe that name.
function unitName(unit: unknown): string | undefined {
  const node = (unit as { node?: { meta?: Record<string, { name?: string }> } })
    ?.node;
  return node?.meta?.["virentia.inspector"]?.name;
}

// Mirrors the library's own `isUnit`: a store/event/effect exposes a `.node`.
function isUnit(value: unknown): boolean {
  return (
    (typeof value === "function" || typeof value === "object") &&
    value !== null &&
    "node" in (value as object)
  );
}

// defineField/fieldType only iterate keys, so minimal plain objects are the
// cleanest way to pin the wrapping rules. Cast through `any` at the boundary.
const define = (field: unknown): any => defineField(field as any);

describe("defineField — wrapping rules (T1..T5)", () => {
  it("returns a shallow copy and never mutates the original", async () => {
    const blob = { nested: 1 };
    const original = {
      kind: "field",
      async fill(_next: unknown) {},
      tag: "keep",
      count: 3,
      blob,
    };
    const defined = define(original);

    expect(defined).not.toBe(original);
    // Original method is left as a plain function (not upgraded to a unit).
    expect(isUnit(original.fill)).toBe(false);
    // Non-function props are copied through; objects keep identity (shallow).
    expect(defined.tag).toBe("keep");
    expect(defined.count).toBe(3);
    expect(defined.blob).toBe(blob);
    // The copy's method IS wrapped even though the original's is not.
    expect(isUnit(defined.fill)).toBe(true);
  });

  it("wraps a plain function method into an effect named `${kind}.${key}`", () => {
    const defined = define({ kind: "custom", async doThing(_p: unknown) {} });

    expect(isUnit(defined.doThing)).toBe(true);
    expect(typeof defined.doThing).toBe("function");
    expect(unitName(defined.doThing)).toBe("custom.doThing");
  });

  it("defaults the kind segment to `field` when the field has no kind", () => {
    const defined = define({ async doThing(_p: unknown) {} });

    expect(unitName(defined.doThing)).toBe("field.doThing");
  });

  it("leaves sync accessors read/serialize/readFields untouched", () => {
    const read = () => 1;
    const serialize = () => ({ value: 1, errors: null });
    const readFields = () => ({});
    const defined = define({
      kind: "s",
      read,
      serialize,
      readFields,
      async fill(_p: unknown) {},
    });

    expect(defined.read).toBe(read);
    expect(defined.serialize).toBe(serialize);
    expect(defined.readFields).toBe(readFields);
    expect(isUnit(defined.read)).toBe(false);
    expect(isUnit(defined.serialize)).toBe(false);
    expect(isUnit(defined.readFields)).toBe(false);
    // A non-accessor method next to them is still wrapped.
    expect(isUnit(defined.fill)).toBe(true);
  });

  it("leaves units (stores, events, and the field's own effects) untouched", () => {
    const state = store(1);
    const changed = event<number>();
    const ownFx = effect(async () => {});
    const defined = define({
      kind: "u",
      state,
      changed,
      ownFx,
      async plain(_p: unknown) {},
    });

    expect(defined.state).toBe(state);
    expect(defined.changed).toBe(changed);
    expect(defined.ownFx).toBe(ownFx);
    // Only the non-unit function is wrapped.
    expect(isUnit(defined.plain)).toBe(true);
  });

  it("copies non-function props through, including falsy and nullish values", () => {
    const obj = {};
    const arr: number[] = [];
    const defined = define({
      kind: "f",
      zero: 0,
      no: false,
      empty: "",
      nil: null,
      undef: undefined,
      obj,
      arr,
    });

    expect(defined.zero).toBe(0);
    expect(defined.no).toBe(false);
    expect(defined.empty).toBe("");
    expect(defined.nil).toBe(null);
    expect("undef" in defined).toBe(true);
    expect(defined.undef).toBe(undefined);
    expect(defined.obj).toBe(obj);
    expect(defined.arr).toBe(arr);
  });

  it("handles the empty object without throwing and copies it", () => {
    const src = {};
    const defined = define(src);

    expect(defined).not.toBe(src);
    expect(defined).toEqual({});
  });
});

describe("defineField — wrapped-method behavior (T6, invocation)", () => {
  it("wrapped methods are awaitable effects that invoke the underlying method", async () => {
    const appScope = scope();
    let ran = false;
    const defined = define({
      kind: "k",
      async go() {
        ran = true;
      },
    });

    await scoped(appScope, async () => {
      const result = defined.go();
      expect(result).toBeInstanceOf(Promise);
      await result;
    });

    expect(ran).toBe(true);
  });

  it("forwards the single payload and resolves with the method's return value", async () => {
    const appScope = scope();
    let seen: unknown;
    const defined = define({
      kind: "k",
      // sync function is still a function → still wrapped
      plain(x: number) {
        seen = x;
        return x * 2;
      },
    });

    await scoped(appScope, async () => {
      const doubled = await defined.plain(21);
      expect(doubled).toBe(42);
    });

    expect(seen).toBe(21);
  });

  it("keeps the ambient scope alive across the wrapped method's await tail", async () => {
    const appScope = scope();
    const defined = define({
      kind: "sc",
      async work() {
        await tick(2);
      },
    });

    await scoped(appScope, async () => {
      await defined.work();
      // The effect wrapper restores the caller's scope on return.
      expect(getCurrentScope()).toBe(appScope);
    });

    expect(getCurrentScope()).toBe(null);
  });

  it("rejects the awaited effect when the wrapped method throws (no abort-swallow)", async () => {
    const appScope = scope();
    const defined = define({
      kind: "err",
      async boom() {
        throw new Error("nope");
      },
    });

    await scoped(appScope, async () => {
      await expect(defined.boom()).rejects.toThrow("nope");
    });
  });
});

describe("defineField — FLAG G-6: multi-arg loss (BUG-PRONE)", () => {
  it("silently drops every argument after the first", async () => {
    const appScope = scope();
    const received: Array<[unknown, unknown]> = [];
    const defined = define({
      kind: "multi",
      async record(a: unknown, b: unknown) {
        received.push([a, b]);
      },
    });

    await scoped(appScope, async () => {
      await defined.record("first", "second");
    });

    // Wrapper is `effect(async (payload) => method(payload))`, so only ONE arg
    // survives. The second argument is lost — see suspectedBugs (G-6).
    expect(received).toEqual([["first", undefined]]);
  });
});

describe("defineField — wild inputs (key enumeration edges)", () => {
  it("copies but does NOT wrap symbol-keyed function props (Object.keys skips symbols)", () => {
    const sym = Symbol("method");
    const defined = define({
      kind: "c",
      [sym]: async () => {},
      async own(_p: unknown) {},
    });

    // Spread copies own enumerable symbols, but the wrap loop iterates only
    // Object.keys (string keys), so the symbol method stays a plain function.
    expect(typeof defined[sym]).toBe("function");
    expect(isUnit(defined[sym])).toBe(false);
    // The string-keyed sibling is still wrapped.
    expect(isUnit(defined.own)).toBe(true);
    expect(unitName(defined.own)).toBe("c.own");
  });

  it("ignores inherited (prototype) methods — only own enumerable keys survive", () => {
    const proto = { async inherited(_p: unknown) {} };
    const src: any = Object.create(proto);
    src.kind = "c";
    src.own = async (_p: unknown) => {};
    const defined = define(src);

    // The shallow copy is a plain object: prototype methods are neither copied
    // nor wrapped, so the inherited method is simply gone from the result.
    expect(defined.inherited).toBeUndefined();
    expect(isUnit(defined.own)).toBe(true);
    expect(unitName(defined.own)).toBe("c.own");
  });

  it("uses an empty-string kind verbatim — `??` only guards nullish, not falsy", () => {
    const defined = define({ kind: "", async doThing(_p: unknown) {} });

    // `field.kind ?? "field"` leaves "" intact, so the name has an empty
    // segment before the dot.
    expect(unitName(defined.doThing)).toBe(".doThing");
  });
});

describe("defineField — idempotency (T7)", () => {
  it("re-defining is a no-op for already-wrapped methods (they are units)", () => {
    const once = define({ kind: "i", async m(_p: unknown) {} });
    const twice = define(once);

    // A fresh shallow copy...
    expect(twice).not.toBe(once);
    // ...but the wrapped method is a unit, so it is copied by reference, not
    // re-wrapped, and its name is unchanged.
    expect(twice.m).toBe(once.m);
    expect(isUnit(twice.m)).toBe(true);
    expect(unitName(twice.m)).toBe("i.m");
  });

  it("applying defineField three times is stable", () => {
    const a = define({ kind: "i", async m(_p: unknown) {} });
    const b = define(a);
    const c = define(b);

    expect(c.m).toBe(a.m);
    expect(unitName(c.m)).toBe("i.m");
  });
});

describe("defineField — real createField integration", () => {
  it("wraps only createField's plain clear helpers and leaves units/accessors alone", () => {
    const raw = createField("x");
    const defined = define(raw);

    // Units untouched.
    expect(defined.fill).toBe(raw.fill);
    expect(defined.state).toBe(raw.state);
    expect(defined.changed).toBe(raw.changed);
    expect(defined.validate).toBe(raw.validate);
    // Sync accessors untouched.
    expect(defined.read).toBe(raw.read);
    expect(defined.serialize).toBe(raw.serialize);
    expect(defined.readFields).toBe(raw.readFields);
    // The two plain-arrow helpers are the only wrapped methods.
    expect(isUnit(raw.clearInnerErrors)).toBe(false);
    expect(isUnit(defined.clearInnerErrors)).toBe(true);
    expect(isUnit(defined.clearOuterErrors)).toBe(true);
    expect(unitName(defined.clearInnerErrors)).toBe("field.clearInnerErrors");
    expect(unitName(defined.clearOuterErrors)).toBe("field.clearOuterErrors");
  });

  it("a wrapped clear helper still works and stays scope-isolated", async () => {
    const field = define(createField(""));
    const scopeA = scope();
    const scopeB = scope();

    await scoped(scopeA, async () => {
      await field.setInnerErrors("boom");
      expect(field.error.value).toBe("boom");
    });

    // Divergent read: scopeB never saw the mutation.
    await scoped(scopeB, async () => {
      expect(field.error.value).toBe(null);
    });

    // The WRAPPED clearInnerErrors effect resolves the error in scopeA only.
    await scoped(scopeA, async () => {
      await field.clearInnerErrors();
      expect(field.error.value).toBe(null);
    });
  });

  it("a defined custom field validates and reports errors inside a form", async () => {
    const appScope = scope();
    const emailField = define(
      createField("", {
        validate: (value: string) => (value.includes("@") ? null : "invalid"),
        validationStrategies: ["change"],
      }),
    );
    const form = createForm({ schema: { email: emailField } });

    await scoped(appScope, async () => {
      await form.fill({ values: { email: "nope" } });
      await form.validate();
      expect(readStoreSnapshot(form.errors)).toEqual({ email: "invalid" });

      await form.fill({ values: { email: "a@b.com" } });
      await form.validate();
      expect(readStoreSnapshot(form.errors)).toEqual({ email: null });
    });
  });
});

describe("fieldType / makeFieldType (T8..T11)", () => {
  it("produces a callable that wraps the factory's field methods", async () => {
    const appScope = scope();
    const ft = fieldType({
      create: (initial: number) =>
        ({
          kind: "num",
          state: store(initial),
          async fill(_p: unknown) {},
          async bump() {},
        }) as any,
    });
    const inst: any = ft(5);

    expect(isUnit(inst.bump)).toBe(true);
    expect(unitName(inst.bump)).toBe("num.bump");
    await scoped(appScope, async () => {
      expect(readStoreSnapshot(inst.state)).toBe(5);
    });
  });

  it("returns a fresh wrapped field instance per call", () => {
    const ft = fieldType({
      create: () => ({ kind: "n", async m() {} }) as any,
    });
    const a: any = ft();
    const b: any = ft();

    expect(a).not.toBe(b);
    expect(a.m).not.toBe(b.m);
  });

  it("FLAG G-7: the `kind` in the config is ignored — effect names use the field's own kind", () => {
    const ft = fieldType({
      kind: "IGNORED_CONFIG_KIND",
      create: () => ({ kind: "real", async m() {} }) as any,
    });
    const inst: any = ft();

    expect(unitName(inst.m)).toBe("real.m");
    expect(unitName(inst.m)).not.toContain("IGNORED_CONFIG_KIND");
  });
});

describe("fieldType.extend (T12..T14)", () => {
  it("wraps inherited methods once (idempotency) and wraps new methods with the new kind", () => {
    const base = fieldType({
      create: (n: number) =>
        ({
          kind: "b",
          state: store(n),
          async fill(_p: unknown) {},
          async baseM() {},
        }) as any,
    });
    const extended = base.extend({
      create(baseFactory, n: number) {
        const field = baseFactory(n);
        return define({ ...field, kind: "e", async extM() {} });
      },
    });
    const inst: any = extended(1);

    // Inherited method: wrapped by the base callable under kind "b", then
    // skipped (already a unit) by both the extension's defineField and the
    // outer callable — name stays "b.baseM".
    expect(isUnit(inst.baseM)).toBe(true);
    expect(unitName(inst.baseM)).toBe("b.baseM");
    // New method wrapped once under the extension's kind "e".
    expect(isUnit(inst.extM)).toBe(true);
    expect(unitName(inst.extM)).toBe("e.extM");
  });

  it("FLAG G-7: the extension's `kind` is ignored", () => {
    const base = fieldType({
      create: (n: number) => ({ kind: "b", state: store(n), async fill() {} }) as any,
    });
    const extended = base.extend({
      kind: "IGNORED_EXT_KIND",
      create(baseFactory, n: number) {
        const field = baseFactory(n);
        return define({ ...field, kind: "realExt", async x() {} });
      },
    });
    const inst: any = extended(1);

    expect(unitName(inst.x)).toBe("realExt.x");
  });

  it("re-parameterizes the factory args (label, initial) and names by the label kind", async () => {
    const appScope = scope();
    const numberType = fieldType({ create: (initial: number) => createField(initial) });
    const relabelled = numberType.extend({
      create(base, label: string, initial: number) {
        return define({ ...base(initial), kind: label, async tag() {} });
      },
    });
    const inst: any = relabelled("mylabel", 7);

    // The runtime kind flows from the first extra arg into the effect name.
    expect(unitName(inst.tag)).toBe("mylabel.tag");
    await scoped(appScope, async () => {
      // The second arg reached the base factory's initial value.
      expect(readStoreSnapshot(inst.state)).toBe(7);
    });
  });

  it("is chainable and composes methods as awaitable effects (trim → uppercase)", async () => {
    const appScope = scope();
    const primitive = fieldType({ create: createField });
    const trimmed = primitive.extend({
      create(base, initial: string) {
        const field = base(initial);
        return define({
          ...field,
          kind: "trimmed",
          async normalize() {
            await field.fill((field.read?.() as string).trim());
          },
        });
      },
    });
    const uppercased = trimmed.extend({
      create(base, initial: string) {
        const field = base(initial);
        return define({
          ...field,
          kind: "uppercased",
          async uppercase() {
            await field.fill((field.read?.() as string).toUpperCase());
          },
        });
      },
    });
    const title: any = uppercased("  virentia  ");

    expect(isUnit(title.normalize)).toBe(true);
    expect(isUnit(title.uppercase)).toBe(true);
    expect(unitName(title.normalize)).toBe("trimmed.normalize");
    expect(unitName(title.uppercase)).toBe("uppercased.uppercase");

    await scoped(appScope, async () => {
      await title.normalize();
      expect(title.state.value).toBe("virentia");

      await title.uppercase();
      expect(title.state.value).toBe("VIRENTIA");
    });
  });

  it("a triple extend chain keeps every layer's method callable", async () => {
    const appScope = scope();
    const l1 = fieldType({ create: createField });
    const l2 = l1.extend({
      create(base, initial: string) {
        const field = base(initial);
        return define({ ...field, kind: "l2", async a() {} });
      },
    });
    const l3 = l2.extend({
      create(base, initial: string) {
        const field = base(initial);
        return define({ ...field, kind: "l3", async b() {} });
      },
    });
    const inst: any = l3("z");

    expect(unitName(inst.a)).toBe("l2.a");
    expect(unitName(inst.b)).toBe("l3.b");

    await scoped(appScope, async () => {
      await inst.a();
      await inst.b();
      expect(getCurrentScope()).toBe(appScope);
    });
  });
});
