import { describe, expect, it } from "vitest";
import {
  createArrayField,
  createField,
  createForm,
  createShapeField,
  readStoreSnapshot,
} from "@virentia/forms";
import { createStore, type Event } from "effector";
import { setupForm } from "./helpers";

/**
 * READ / WATCH direction (virentia -> effector) of `formToEffector`:
 *   - bridge.ts: `readInitial` (throwaway-scope seeding) + `bridgeStore` /
 *     `bridgeEvent` mirroring.
 *   - the read side of lens.ts: `getSource` / `ids` / `where` / `first` /
 *     `last` / `single` / `props` selection operators and `clock()` watch units.
 *
 * The dispatch direction (effector -> virentia: `target`, `delete`, driving the
 * bridged effects) is intentionally NOT exercised here — that is a separate
 * module and is specced as pending in form-to-effector.test.ts.
 *
 * Virentia is the source of truth: every mutation is driven on the virentia side
 * via `drive(() => form.<method>())`, then observed through the effector scope
 * via `read(store) = eScope.getState(store)`.
 */

/** Flush `n` microtask hops so a fire-and-forget virentia reaction settles. */
async function tick(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/* ================================================================== *
 * Initial seeding via readInitial (throwaway scope)
 * ================================================================== */

describe("readInitial seeding — every $-store starts at the form's initial value", () => {
  const seed = () =>
    setupForm(
      createForm({ schema: { email: createField("a@b.c"), age: createField(21) } }),
    );

  it("$values seeds to the initial values", () => {
    const { model, read } = seed();
    expect(read(model.$values)).toEqual({ email: "a@b.c", age: 21 });
  });

  it("$value seeds identically to $values", () => {
    const { model, read } = seed();
    expect(read(model.$value)).toEqual({ email: "a@b.c", age: 21 });
  });

  it("$errors seeds to a per-field null map", () => {
    const { model, read } = seed();
    expect(read(model.$errors)).toEqual({ email: null, age: null });
  });

  it("$innerErrors seeds to a per-field null map", () => {
    const { model, read } = seed();
    expect(read(model.$innerErrors)).toEqual({ email: null, age: null });
  });

  it("$outerErrors seeds to a per-field null map", () => {
    const { model, read } = seed();
    expect(read(model.$outerErrors)).toEqual({ email: null, age: null });
  });

  it("$snapshot seeds to the initial values", () => {
    const { model, read } = seed();
    expect(read(model.$snapshot)).toEqual({ email: "a@b.c", age: 21 });
  });

  it("$isChanged seeds to false (values match snapshot)", () => {
    const { model, read } = seed();
    expect(read(model.$isChanged)).toBe(false);
  });

  it("$isValid seeds to true (no errors)", () => {
    const { model, read } = seed();
    expect(read(model.$isValid)).toBe(true);
  });

  it("$isValidationPending seeds to false", () => {
    const { model, read } = seed();
    expect(read(model.$isValidationPending)).toBe(false);
  });

  it("seeds a field's initial outer error, flipping $isValid to false", () => {
    const { model, read } = setupForm(
      createForm({ schema: { email: createField("a@b.c", { error: "seed-error" }) } }),
    );
    expect(read(model.$outerErrors)).toEqual({ email: "seed-error" });
    expect(read(model.$errors)).toEqual({ email: "seed-error" });
    expect(read(model.$innerErrors)).toEqual({ email: null });
    expect(read(model.$isValid)).toBe(false);
  });

  it("seeds nested-group and collection values structurally", () => {
    const { model, read } = setupForm(
      createForm({
        schema: {
          address: { street: createField("Main"), zip: createField("00000") },
          tags: createArrayField<string>(["x", "y"]),
        },
      }),
    );
    expect(read(model.$values)).toEqual({
      address: { street: "Main", zip: "00000" },
      tags: ["x", "y"],
    });
  });
});

/* ================================================================== *
 * Mirroring: a virentia-side mutation reflects in the effector store
 * ================================================================== */

describe("mirroring — bridgeStore reflects virentia-side mutations in eScope", () => {
  it("mirrors $values / $value after a form.fill", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    await h.drive(() => h.form.fill({ values: { email: "next@x.y" } }));
    expect(h.read(h.model.$values)).toEqual({ email: "next@x.y" });
    expect(h.read(h.model.$value)).toEqual({ email: "next@x.y" });
  });

  it("mirrors $errors / $innerErrors and flips $isValid after validation fails", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(16) },
        validation: (v: { age: number }) => (v.age >= 18 ? null : { age: "Too young" }),
      }),
    );
    await h.drive(() => h.form.validate());
    expect(h.read(h.model.$errors)).toEqual({ age: "Too young" });
    expect(h.read(h.model.$innerErrors)).toEqual({ age: "Too young" });
    expect(h.read(h.model.$isValid)).toBe(false);
  });

  it("mirrors $outerErrors from fill({ errors }) and $isValid, then clears on clearOuterErrors", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    await h.drive(() => h.form.fill({ errors: { email: "bad" } }));
    expect(h.read(h.model.$outerErrors)).toEqual({ email: "bad" });
    expect(h.read(h.model.$errors)).toEqual({ email: "bad" });
    expect(h.read(h.model.$isValid)).toBe(false);
    await h.drive(() => h.form.clearOuterErrors());
    expect(h.read(h.model.$errors)).toEqual({ email: null });
    expect(h.read(h.model.$isValid)).toBe(true);
  });

  it("mirrors $innerErrors cleared by clearInnerErrors", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(10) },
        validation: (v: { age: number }) => (v.age >= 18 ? null : { age: "young" }),
      }),
    );
    await h.drive(() => h.form.validate());
    expect(h.read(h.model.$innerErrors)).toEqual({ age: "young" });
    await h.drive(() => h.form.clearInnerErrors());
    expect(h.read(h.model.$innerErrors)).toEqual({ age: null });
  });

  it("mirrors $isChanged as the form drifts from and returns to its snapshot", async () => {
    const h = setupForm(createForm({ schema: { name: createField("initial") } }));
    expect(h.read(h.model.$isChanged)).toBe(false);
    await h.drive(() => h.form.fill({ values: { name: "changed" } }));
    expect(h.read(h.model.$isChanged)).toBe(true);
    await h.drive(() => h.form.reset());
    expect(h.read(h.model.$isChanged)).toBe(false);
    expect(h.read(h.model.$values)).toEqual({ name: "initial" });
  });

  it("$snapshot stays at initial after a fill (fill does not re-snapshot)", async () => {
    const h = setupForm(createForm({ schema: { name: createField("init") } }));
    await h.drive(() => h.form.fill({ values: { name: "drift" } }));
    expect(h.read(h.model.$snapshot)).toEqual({ name: "init" });
    expect(h.read(h.model.$isChanged)).toBe(true);
  });

  it("mirrors $snapshot after forceUpdateSnapshot (adopts current values, $isChanged -> false)", async () => {
    const h = setupForm(createForm({ schema: { name: createField("init") } }));
    await h.drive(() => h.form.fill({ values: { name: "drift" } }));
    await h.drive(() => h.form.forceUpdateSnapshot());
    expect(h.read(h.model.$snapshot)).toEqual({ name: "drift" });
    expect(h.read(h.model.$isChanged)).toBe(false);
  });

  it("mirrors $snapshot restored to initial after reset (even post-forceUpdate)", async () => {
    const h = setupForm(createForm({ schema: { name: createField("init") } }));
    await h.drive(() => h.form.fill({ values: { name: "a" } }));
    await h.drive(() => h.form.forceUpdateSnapshot());
    await h.drive(() => h.form.fill({ values: { name: "b" } }));
    await h.drive(() => h.form.reset());
    expect(h.read(h.model.$snapshot)).toEqual({ name: "init" });
    expect(h.read(h.model.$values)).toEqual({ name: "init" });
  });

  it("$isValid flips back to true once validation passes on new values", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(16) },
        validation: (v: { age: number }) => (v.age >= 18 ? null : { age: "Too young" }),
      }),
    );
    await h.drive(() => h.form.validate());
    expect(h.read(h.model.$isValid)).toBe(false);
    await h.drive(() => h.form.fill({ values: { age: 20 } }));
    await h.drive(() => h.form.validate());
    expect(h.read(h.model.$isValid)).toBe(true);
    expect(h.read(h.model.$errors)).toEqual({ age: null });
  });

  it("$isValidationPending settles back to false after a validation run", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(21) },
        validation: (v: { age: number }) => (v.age >= 18 ? null : { age: "young" }),
      }),
    );
    await h.drive(() => h.form.validate());
    await h.drive(() => tick(10));
    expect(h.read(h.model.$isValidationPending)).toBe(false);
  });
});

/* ================================================================== *
 * Event bridging: virentia output events -> effector events
 * ================================================================== */

describe("event bridging — bridgeEvent fires into the effector scope on the matching virentia action", () => {
  it("`filled` fires with the new values on a fill", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const $log = createStore<any[]>([]).on(h.model.filled, (log, v) => [...log, v]);
    await h.drive(() => h.form.fill({ values: { email: "z@z.z" } }));
    expect(h.read($log)).toEqual([{ email: "z@z.z" }]);
  });

  it("`changed` fires with the new values on a fill", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const $log = createStore<any[]>([]).on(h.model.changed, (log, v) => [...log, v]);
    await h.drive(() => h.form.fill({ values: { email: "z@z.z" } }));
    expect(h.read($log)).toEqual([{ email: "z@z.z" }]);
  });

  it("`errorsChanged` fires on a fill", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const $count = createStore(0).on(h.model.errorsChanged, (n) => n + 1);
    await h.drive(() => h.form.fill({ values: { email: "x@y.z" } }));
    expect(h.read($count)).toBeGreaterThanOrEqual(1);
  });

  it("`validated` fires (and `validationFailed` does not) when validation passes", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(21) },
        validation: (v: { age: number }) => (v.age >= 18 ? null : { age: "young" }),
      }),
    );
    const $ok = createStore<any[]>([]).on(h.model.validated, (l, v) => [...l, v]);
    const $fail = createStore(0).on(h.model.validationFailed, (n) => n + 1);
    await h.drive(() => h.form.validate());
    expect(h.read($ok)).toEqual([{ age: 21 }]);
    expect(h.read($fail)).toBe(0);
  });

  it("`validationFailed` fires (and `validated` does not) when validation fails", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(10) },
        validation: (v: { age: number }) => (v.age >= 18 ? null : { age: "young" }),
      }),
    );
    const $ok = createStore(0).on(h.model.validated, (n) => n + 1);
    const $fail = createStore<any[]>([]).on(h.model.validationFailed, (l, v) => [...l, v]);
    await h.drive(() => h.form.validate());
    expect(h.read($ok)).toBe(0);
    expect(h.read($fail)).toEqual([{ age: 10 }]);
  });

  it("`submitted` fires with the values on submit", async () => {
    const h = setupForm(createForm({ schema: { age: createField(21) } }));
    const $sub = createStore<any[]>([]).on(h.model.submitted, (l, v) => [...l, v]);
    await h.drive(async () => {
      h.form.submit();
      await tick(30);
    });
    expect(h.read($sub)).toEqual([{ age: 21 }]);
  });

  it("`validatedAndSubmitted` fires on a valid submit", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(21) },
        validation: (v: { age: number }) => (v.age >= 18 ? null : { age: "young" }),
      }),
    );
    const $sub = createStore<any[]>([]).on(h.model.submitted, (l, v) => [...l, v]);
    const $vas = createStore<any[]>([]).on(h.model.validatedAndSubmitted, (l, v) => [...l, v]);
    await h.drive(async () => {
      h.form.submit();
      await tick(30);
    });
    expect(h.read($sub)).toEqual([{ age: 21 }]);
    expect(h.read($vas)).toEqual([{ age: 21 }]);
  });

  it("`validatedAndSubmitted` does NOT fire on an invalid submit (but `submitted` does)", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(10) },
        validation: (v: { age: number }) => (v.age >= 18 ? null : { age: "young" }),
      }),
    );
    const $sub = createStore(0).on(h.model.submitted, (n) => n + 1);
    const $vas = createStore(0).on(h.model.validatedAndSubmitted, (n) => n + 1);
    await h.drive(async () => {
      h.form.submit();
      await tick(30);
    });
    expect(h.read($sub)).toBe(1);
    expect(h.read($vas)).toBe(0);
  });

  it("a bridged event does not fire when no matching virentia action occurs", () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const $log = createStore(0).on(h.model.filled, (n) => n + 1);
    expect(h.read($log)).toBe(0);
  });
});

/* ================================================================== *
 * Lens WATCH — leaf field units
 * ================================================================== */

describe("lens watch — leaf field unit `clock()` fires on the effector side", () => {
  it("`fields.email.state.clock()` fires with the new value when the field changes", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const clock = h.drive(() => (h.model.fields as any).email.state.clock()) as Event<string>;
    const $seen = createStore<string[]>([]).on(clock, (log, v) => [...log, v]);
    await h.drive(() => h.form.fill({ values: { email: "watched" } }));
    expect(h.read($seen)).toContain("watched");
  });

  it("`fields.email.changed.clock()` (an output event unit) fires with the new value", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const clock = h.drive(() => (h.model.fields as any).email.changed.clock()) as Event<string>;
    const $seen = createStore<string[]>([]).on(clock, (log, v) => [...log, v]);
    await h.drive(() => h.form.fill({ values: { email: "boop" } }));
    expect(h.read($seen)).toContain("boop");
  });

  it("a read-only store unit (`state`) is watch-only: `clock` present, `target` absent", () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const email = (h.model.fields as any).email;
    expect(typeof email.state.clock).toBe("function");
    expect(email.state.target).toBeUndefined();
  });

  it("a callable event unit (`change`) is targetable: both `clock` and `target` present", () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const email = (h.model.fields as any).email;
    expect(typeof email.change.clock).toBe("function");
    expect(typeof email.change.target).toBe("function");
  });

  it("an effect unit (`fill`) is targetable: `target` present", () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const email = (h.model.fields as any).email;
    expect(typeof email.fill.target).toBe("function");
  });

  it("non-unit members (`read`, `kind`, `serialize`, `clearInnerErrors`) drop out of the lens", () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const email = (h.model.fields as any).email;
    expect("read" in email).toBe(false);
    expect("kind" in email).toBe(false);
    expect("serialize" in email).toBe(false);
    expect("clearInnerErrors" in email).toBe(false);
    // …but the real unit members are present.
    expect("state" in email).toBe(true);
    expect("change" in email).toBe(true);
  });
});

describe("lens watch — nested plain group recurses per key", () => {
  it("`fields.address.street.state.clock()` fires when a nested field changes", async () => {
    const h = setupForm(
      createForm({
        schema: { address: { street: createField(""), city: createField("") } },
      }),
    );
    const clock = h.drive(() =>
      (h.model.fields as any).address.street.state.clock(),
    ) as Event<string>;
    const $seen = createStore<string[]>([]).on(clock, (log, v) => [...log, v]);
    await h.drive(() =>
      h.form.fill({ values: { address: { street: "Elm" } } as any }),
    );
    expect(h.read($seen)).toContain("Elm");
  });

  it("a nested group stays a plain object of lens nodes (not a collection lens)", () => {
    const h = setupForm(
      createForm({ schema: { address: { street: createField("") } } }),
    );
    const address = (h.model.fields as any).address;
    expect(typeof address.getSource).toBe("undefined");
    expect(typeof address.street.state.clock).toBe("function");
  });
});

/* ================================================================== *
 * Lens READ — array collection lens
 * ================================================================== */

describe("lens read — array collection lens (read side)", () => {
  const makeTags = () =>
    setupForm(createForm({ schema: { tags: createArrayField<string>(["a", "b", "c"]) } }));

  it("`getSource()` returns the current items keyed by stable id", () => {
    const h = makeTags();
    const source = h.drive(() => (h.model.fields as any).tags.getSource());
    expect(Object.keys(source)).toEqual(["0", "1", "2"]);
  });

  it("assigns a stable id per item, consistent across repeated reads", () => {
    const h = makeTags();
    const first = h.drive(() => Object.keys((h.model.fields as any).tags.getSource()));
    const second = h.drive(() => Object.keys((h.model.fields as any).tags.getSource()));
    expect(second).toEqual(first);
    expect(first).toHaveLength(3);
  });

  it("`ids(...)` narrows the collection to the requested stable ids", () => {
    const h = makeTags();
    const [firstId] = h.drive(() => Object.keys((h.model.fields as any).tags.getSource()));
    const narrowed = h.drive(() =>
      Object.keys((h.model.fields as any).tags.ids(firstId).getSource()),
    );
    expect(narrowed).toEqual([firstId]);
  });

  it("`ids(...)` with multiple ids narrows to exactly those", () => {
    const h = makeTags();
    const narrowed = h.drive(() =>
      Object.keys((h.model.fields as any).tags.ids("0", "2").getSource()),
    );
    expect(narrowed).toEqual(["0", "2"]);
  });

  it("`ids(nonexistent)` narrows to an empty collection", () => {
    const h = makeTags();
    const narrowed = h.drive(() =>
      Object.keys((h.model.fields as any).tags.ids("does-not-exist").getSource()),
    );
    expect(narrowed).toEqual([]);
  });

  it("`first()` keeps only the first item", () => {
    const h = makeTags();
    expect(h.drive(() => Object.keys((h.model.fields as any).tags.first().getSource()))).toEqual(["0"]);
  });

  it("`last()` keeps only the last item", () => {
    const h = makeTags();
    expect(h.drive(() => Object.keys((h.model.fields as any).tags.last().getSource()))).toEqual(["2"]);
  });

  it("`single()` yields nothing when more than one item matches", () => {
    const h = makeTags();
    expect(h.drive(() => Object.keys((h.model.fields as any).tags.single().getSource()))).toEqual([]);
  });

  it("`single()` yields the one item when exactly one matches", () => {
    const h = makeTags();
    const only = h.drive(() =>
      Object.keys((h.model.fields as any).tags.ids("1").single().getSource()),
    );
    expect(only).toEqual(["1"]);
  });

  it("`where(pred)` filters on each item's `value` and `id`", () => {
    const h = makeTags();
    const matched = h.drive(() =>
      Object.keys((h.model.fields as any).tags.where((d: any) => d.value === "b").getSource()),
    );
    expect(matched).toEqual(["1"]);
  });

  it("`where` exposes the stable `id` on the item data", () => {
    const h = makeTags();
    const matched = h.drive(() =>
      Object.keys((h.model.fields as any).tags.where((d: any) => d.id === "2").getSource()),
    );
    expect(matched).toEqual(["2"]);
  });

  it("chained `where` predicates compose (AND semantics)", () => {
    const h = setupForm(createForm({ schema: { tags: createArrayField<string>(["a", "ab", "b"]) } }));
    const matched = h.drive(() =>
      Object.keys(
        (h.model.fields as any).tags
          .where((d: any) => (d.value as string).includes("a"))
          .where((d: any) => (d.value as string).includes("b"))
          .getSource(),
      ),
    );
    expect(matched).toEqual(["1"]); // only "ab"
  });

  it("`props()` is a no-op passthrough on the read side", () => {
    const h = makeTags();
    expect(h.drive(() => Object.keys((h.model.fields as any).tags.props().getSource()))).toEqual([
      "0",
      "1",
      "2",
    ]);
  });

  it("`clock` / `target` are hidden at the collection root (path is empty)", () => {
    const h = makeTags();
    expect(h.drive(() => (h.model.fields as any).tags.clock)).toBeUndefined();
    expect(h.drive(() => (h.model.fields as any).tags.target)).toBeUndefined();
  });

  it("navigating into an item leaf unit exposes `clock` / `target` actions (nested field unit actions exist)", () => {
    const h = makeTags();
    // Pure proxy navigation — needs no ambient scope. (Do NOT route this through
    // `drive`: the lens proxy is thenable, so `scoped` would wrap it in a Promise;
    // see the has-trap test below.)
    const leaf = (h.model.fields as any).tags.state;
    expect(typeof leaf.clock).toBe("function");
    expect(typeof leaf.target).toBe("function");
  });

  it("navigating an arbitrary item child key still yields a lens with actions", () => {
    const h = makeTags();
    const nested = (h.model.fields as any).tags.some.deep.path;
    expect(typeof nested.clock).toBe("function");
    expect(typeof nested.getSource).toBe("function");
  });
});

/* ================================================================== *
 * Lens READ — shape collection lens (keyed by child key)
 * ================================================================== */

describe("lens read — shape collection lens (keyed by child key)", () => {
  const makeProfile = () =>
    setupForm(
      createForm({
        schema: {
          profile: createShapeField({
            first: createField("Ada"),
            last: createField("Lovelace"),
          }),
        },
      }),
    );

  it("`getSource()` is keyed by the shape's child keys", () => {
    const h = makeProfile();
    const source = h.drive(() => (h.model.fields as any).profile.getSource());
    expect(Object.keys(source).sort()).toEqual(["first", "last"]);
  });

  it("`ids('first')` narrows to a single child key", () => {
    const h = makeProfile();
    const narrowed = h.drive(() =>
      Object.keys((h.model.fields as any).profile.ids("first").getSource()),
    );
    expect(narrowed).toEqual(["first"]);
  });

  it("`where` sees each child's `value` and `id` (the child key)", () => {
    const h = makeProfile();
    const matched = h.drive(() =>
      Object.keys(
        (h.model.fields as any).profile.where((d: any) => d.id === "last").getSource(),
      ),
    );
    expect(matched).toEqual(["last"]);
  });

  it("`first()` keeps the first child key of the shape", () => {
    const h = makeProfile();
    const keys = h.drive(() => Object.keys((h.model.fields as any).profile.getSource()));
    const first = h.drive(() => Object.keys((h.model.fields as any).profile.first().getSource()));
    expect(first).toEqual([keys[0]]);
  });

  it("`last()` keeps the last child key of the shape", () => {
    const h = makeProfile();
    const keys = h.drive(() => Object.keys((h.model.fields as any).profile.getSource()));
    const last = h.drive(() => Object.keys((h.model.fields as any).profile.last().getSource()));
    expect(last).toEqual([keys[keys.length - 1]]);
  });

  it("`where` matches on a child's leaf `value` (readItemData reads normalized.state)", () => {
    const h = makeProfile();
    const matched = h.drive(() =>
      Object.keys((h.model.fields as any).profile.where((d: any) => d.value === "Ada").getSource()),
    );
    expect(matched).toEqual(["first"]);
  });

  it("`single()` yields nothing when the shape has more than one child key", () => {
    const h = makeProfile();
    expect(h.drive(() => Object.keys((h.model.fields as any).profile.single().getSource()))).toEqual([]);
  });

  it("`ids('first').single()` yields the one narrowed child key", () => {
    const h = makeProfile();
    const only = h.drive(() =>
      Object.keys((h.model.fields as any).profile.ids("first").single().getSource()),
    );
    expect(only).toEqual(["first"]);
  });

  it("`ids('nope')` narrows the shape to an empty collection", () => {
    const h = makeProfile();
    const narrowed = h.drive(() =>
      Object.keys((h.model.fields as any).profile.ids("nope").getSource()),
    );
    expect(narrowed).toEqual([]);
  });
});

/* ================================================================== *
 * Scope isolation
 * ================================================================== */

describe("scope isolation — paired (vScope, eScope) harnesses are independent", () => {
  it("two harnesses hold independent $values", async () => {
    const a = setupForm(createForm({ schema: { n: createField("base") } }));
    const b = setupForm(createForm({ schema: { n: createField("base") } }));
    await a.drive(() => a.form.fill({ values: { n: "A" } }));
    expect(a.read(a.model.$values)).toEqual({ n: "A" });
    expect(b.read(b.model.$values)).toEqual({ n: "base" });
  });

  it("an event fired in one harness does not fire the other's mirror", async () => {
    const a = setupForm(createForm({ schema: { n: createField("") } }));
    const b = setupForm(createForm({ schema: { n: createField("") } }));
    const $a = createStore(0).on(a.model.filled, (x) => x + 1);
    const $b = createStore(0).on(b.model.filled, (x) => x + 1);
    await a.drive(() => a.form.fill({ values: { n: "x" } }));
    expect(a.read($a)).toBe(1);
    expect(b.read($b)).toBe(0);
  });
});

/* ================================================================== *
 * WILD / adversarial inputs
 * ================================================================== */

describe("WILD — empty schema, base-scope getSource, nested shape-in-array", () => {
  it("an empty-schema form seeds empty $values / empty fields and stays valid", () => {
    const h = setupForm(createForm({ schema: {} }));
    expect(h.read(h.model.$values)).toEqual({});
    expect(h.read(h.model.$errors)).toEqual({});
    expect(h.read(h.model.$isValid)).toBe(true);
    expect(h.read(h.model.$isChanged)).toBe(false);
    expect(h.model.fields).toEqual({});
  });

  it("a nested shape-in-array getSource is keyed by stable item ids", () => {
    const h = setupForm(
      createForm({
        schema: {
          people: createArrayField([{ name: "A" }, { name: "B" }], {
            createItem: (v: { name: string }) =>
              createShapeField({ name: createField(v.name) }) as any,
          }),
        },
      }),
    );
    const source = h.drive(() => (h.model.fields as any).people.getSource());
    expect(Object.keys(source)).toEqual(["0", "1"]);
    // Each entry is the item field instance (a shape field), not a serialized value.
    expect(typeof (Object.values(source)[0] as any).kind).toBe("string");
  });

  it("a nested shape-in-array narrows by id via `ids(...)`", () => {
    const h = setupForm(
      createForm({
        schema: {
          people: createArrayField([{ name: "A" }, { name: "B" }, { name: "C" }], {
            createItem: (v: { name: string }) =>
              createShapeField({ name: createField(v.name) }) as any,
          }),
        },
      }),
    );
    const narrowed = h.drive(() =>
      Object.keys((h.model.fields as any).people.ids("1").getSource()),
    );
    expect(narrowed).toEqual(["1"]);
  });

  it("`where` over object-valued items spreads the item value onto the predicate data (object branch of readItemData)", () => {
    const h = setupForm(
      createForm({
        schema: {
          people: createArrayField([{ name: "A" }, { name: "B" }], {
            createItem: (v: { name: string }) =>
              createShapeField({ name: createField(v.name) }) as any,
          }),
        },
      }),
    );
    // Each item's serialized value is an object `{ name }`, so it is spread onto
    // the predicate data (plus the stable `id`) rather than wrapped as `{ value }`.
    const matched = h.drive(() =>
      Object.keys(
        (h.model.fields as any).people.where((d: any) => d.name === "B").getSource(),
      ),
    );
    expect(matched).toEqual(["1"]);
  });

  /**
   * getSource() reads the collection through `readCurrent`, which reflects the
   * ambient (paired) scope when one is active — so a scoped `push`/`remove` is
   * visible, matching what the bridged `$values` store reports via `fool`.
   */
  it("getSource() reflects a scoped push (reads the ambient scope) — matching $values", async () => {
    const h = setupForm(createForm({ schema: { tags: createArrayField<string>(["a", "b", "c"]) } }));
    const before = h.drive(() => Object.keys((h.model.fields as any).tags.getSource()));
    expect(before).toEqual(["0", "1", "2"]);
    await h.drive(() => (h.form.fields.tags as any).push("d"));
    // The mirrored store observed the mutation…
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "b", "c", "d"] });
    // …and getSource now reflects it too — a fresh stable id for the new item.
    const afterPush = h.drive(() => Object.keys((h.model.fields as any).tags.getSource()));
    expect(afterPush).toEqual(["0", "1", "2", "3"]);
  });

  it("getSource() reflects a scoped remove and keeps stable ids for survivors — matching $values", async () => {
    const h = setupForm(createForm({ schema: { tags: createArrayField<string>(["a", "b", "c"]) } }));
    // Assign ids to all three up front: a=0, b=1, c=2 (WeakMap keyed by instance).
    const before = h.drive(() => Object.keys((h.model.fields as any).tags.getSource()));
    expect(before).toEqual(["0", "1", "2"]);
    await h.drive(() => (h.form.fields.tags as any).remove(0));
    expect(h.read(h.model.$values)).toEqual({ tags: ["b", "c"] });
    // getSource now reflects the removal; the survivors b & c keep their original ids.
    const afterRemove = h.drive(() => Object.keys((h.model.fields as any).tags.getSource()));
    expect(afterRemove).toEqual(["1", "2"]);
  });

  /**
   * The collection-lens proxy refuses the promise-detection keys
   * (`then`/`catch`/`finally`), so the lens is NOT thenable and can be returned
   * safely from a promise-aware boundary (`await`, `scoped`/`drive`) without
   * being wrapped in a Promise. Other keys still navigate the item shape.
   */
  it("the collection lens is NOT thenable and survives being returned from a scoped block", () => {
    const h = setupForm(createForm({ schema: { tags: createArrayField<string>(["a"]) } }));
    const lens = (h.model.fields as any).tags.state;
    expect("then" in lens).toBe(false);
    expect("catch" in lens).toBe(false);
    expect("finally" in lens).toBe(false);
    expect(lens.then).toBeUndefined();
    // Other keys still navigate (the proxy is a navigation surface).
    expect("literally-anything" in lens).toBe(true);
    // Routing the raw proxy through `drive` (scoped) yields the lens itself, not a Promise.
    const routed = h.drive(() => (h.model.fields as any).tags.state);
    expect(routed instanceof Promise).toBe(false);
    expect(typeof routed.getSource).toBe("function");
  });

  it("an empty array field getSource is an empty collection", () => {
    const h = setupForm(createForm({ schema: { tags: createArrayField<string>([]) } }));
    expect(h.drive(() => Object.keys((h.model.fields as any).tags.getSource()))).toEqual([]);
    expect(h.drive(() => Object.keys((h.model.fields as any).tags.first().getSource()))).toEqual([]);
    expect(h.drive(() => Object.keys((h.model.fields as any).tags.single().getSource()))).toEqual([]);
  });

  /**
   * BUG PIN (see bugsSuspected: collection-clock-never-fires).
   *
   * `fields.<array-leaf>.clock()` builds a re-subscribing reaction over the
   * matched items (collectionClock). The initial subscription resolves items via
   * `readBase` (a throwaway scope), so the reactions are bound to base-scope item
   * instances and never observe value changes made in the paired virentia scope —
   * the resubscribe-on-membership-change path is likewise ineffective. The result
   * is that the collection leaf `clock()` emits NOTHING when an item's value
   * changes, even though the bridged `$values` store (via `fool` on the form's
   * values) correctly reflects that same change.
   *
   * Contrast with the plain leaf-field `state.clock()`, which fires (see the
   * "lens watch — leaf field unit" suite). We pin the current (non-firing)
   * behavior GREEN rather than assert the intended effector-kit/models semantics.
   */
  it("collection leaf `clock()` does NOT fire on an item value change — while $values does", async () => {
    const h = setupForm(createForm({ schema: { tags: createArrayField<string>(["a", "b"]) } }));
    const clock = h.drive(() => (h.model.fields as any).tags.state.clock()) as Event<string>;
    const $seen = createStore<string[]>([]).on(clock, (log, v) => [...log, v]);
    await h.drive(async () => {
      const items = readStoreSnapshot((h.form.fields.tags as any).items) as any[];
      items[0].change("Z");
      await tick(5);
    });
    await h.drive(() => tick(5));
    // The mirrored store observed the mutation…
    expect(h.read(h.model.$values)).toEqual({ tags: ["Z", "b"] });
    // …but the collection leaf clock produced no events (the pinned behavior).
    expect(h.read($seen)).toEqual([]);
  });
});
