import { describe, expect, it } from "vitest";
import {
  createArrayField,
  createField,
  createForm,
  createShapeField,
  readStoreSnapshot,
} from "@virentia/forms";
import { allSettled, createStore } from "effector";
import { setupForm } from "./helpers";

/**
 * DISPATCH direction (effector -> virentia) of `formToEffector`:
 *   - bridge.ts `bridgeMethod`: every mutating form method is a fooled virentia
 *     effect; `allSettled(model.<method>, { scope, params })` runs the virentia
 *     method inside the associated virentia scope.
 *   - lens.ts dispatchers: leaf `target(map?)` (`targetOf`), collection
 *     `target(map?)` / `delete()` (`collectionTarget` / `buildCollectionLens`),
 *     resolved through the `where` / `ids` / `first` / `last` / `single` / `props`
 *     selection operators.
 *
 * Virentia stays the source of truth. A dispatch is driven from the effector
 * scope; the virentia mutation is then observed through the mirrored `$`-stores
 * (`read(store) = eScope.getState(store)`) and the bridged lifecycle events.
 *
 * A lens dispatch unit must be *built* inside the virentia scope (the lens reads
 * computeds on construction), so terminals are produced via `drive(() => ...)`
 * and then driven with `allSettled(unit, { scope: eScope, params })`.
 */

/** Count effector-scope firings of a bridged lifecycle event. */
const counter = (event: unknown) =>
  createStore(0).on(event as never, (n: number) => n + 1);

/** Collect effector-scope payloads of a bridged lifecycle event. */
const collector = <T>(event: unknown) =>
  createStore<T[]>([]).on(event as never, (log: T[], value: T) => [
    ...log,
    value,
  ]);

/* ================================================================== *
 * bridgeMethod — form.fill
 * ================================================================== */

describe("dispatch — model.fill", () => {
  it("`allSettled(fill, { values })` mutates the virentia form and mirrors $values", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { values: { email: "next@x.y" } },
    });
    expect(h.read(h.model.$values)).toEqual({ email: "next@x.y" });
    expect(h.read(h.model.$value)).toEqual({ email: "next@x.y" });
    // Virentia (source of truth) agrees with the mirror.
    expect(h.drive(() => readStoreSnapshot(h.form.values))).toEqual({
      email: "next@x.y",
    });
  });

  it("emits `filled` and `changed` into the effector scope with the next values", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const $filled = collector<{ email: string }>(h.model.filled);
    const $changed = collector<{ email: string }>(h.model.changed);
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { values: { email: "z@z.z" } },
    });
    expect(h.read($filled)).toEqual([{ email: "z@z.z" }]);
    expect(h.read($changed)).toEqual([{ email: "z@z.z" }]);
  });

  it("`allSettled(fill, { errors })` applies OUTER errors and flips $isValid", async () => {
    const h = setupForm(createForm({ schema: { email: createField("x") } }));
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { errors: { email: "bad" } },
    });
    expect(h.read(h.model.$errors)).toEqual({ email: "bad" });
    expect(h.read(h.model.$outerErrors)).toEqual({ email: "bad" });
    expect(h.read(h.model.$innerErrors)).toEqual({ email: null });
    expect(h.read(h.model.$isValid)).toBe(false);
  });

  it("`allSettled(fill, { values, errors })` applies both in one dispatch", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { values: { email: "e@e.e" }, errors: { email: "still bad" } },
    });
    expect(h.read(h.model.$values)).toEqual({ email: "e@e.e" });
    expect(h.read(h.model.$outerErrors)).toEqual({ email: "still bad" });
  });

  it("marks the form as changed (drifted from snapshot)", async () => {
    const h = setupForm(createForm({ schema: { name: createField("initial") } }));
    expect(h.read(h.model.$isChanged)).toBe(false);
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { values: { name: "changed" } },
    });
    expect(h.read(h.model.$isChanged)).toBe(true);
  });
});

/* ================================================================== *
 * bridgeMethod — form.validate
 * ================================================================== */

describe("dispatch — model.validate", () => {
  const makeAgeForm = (age: number) =>
    setupForm(
      createForm({
        schema: { age: createField(age) },
        validation: (values: { age: number }) =>
          values.age >= 18 ? null : { age: "Too young" },
      }),
    );

  it("populates $errors and emits `validationFailed` (not `validated`) when invalid", async () => {
    const h = makeAgeForm(10);
    const $validated = counter(h.model.validated);
    const $failed = counter(h.model.validationFailed);
    await allSettled(h.model.validate, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$errors)).toEqual({ age: "Too young" });
    expect(h.read(h.model.$isValid)).toBe(false);
    expect(h.read($validated)).toBe(0);
    expect(h.read($failed)).toBe(1);
  });

  it("emits `validated` (not `validationFailed`) and keeps $errors clear when valid", async () => {
    const h = makeAgeForm(21);
    const $validated = counter(h.model.validated);
    const $failed = counter(h.model.validationFailed);
    await allSettled(h.model.validate, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$errors)).toEqual({ age: null });
    expect(h.read(h.model.$isValid)).toBe(true);
    expect(h.read($validated)).toBe(1);
    expect(h.read($failed)).toBe(0);
  });

  it("emits `errorsChanged` while running (inner errors are cleared then re-derived)", async () => {
    const h = makeAgeForm(10);
    const $errorsChanged = counter(h.model.errorsChanged);
    await allSettled(h.model.validate, { scope: h.eScope, params: undefined });
    // validateFx clears inner errors (one emit) then applies the result (another).
    expect(h.read($errorsChanged)).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== *
 * bridgeMethod — form.reset
 * ================================================================== */

describe("dispatch — model.reset", () => {
  it("restores the snapshot and clears $isChanged, emitting `changed`", async () => {
    const h = setupForm(createForm({ schema: { name: createField("init") } }));
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { values: { name: "changed" } },
    });
    expect(h.read(h.model.$isChanged)).toBe(true);

    const $changed = collector<{ name: string }>(h.model.changed);
    await allSettled(h.model.reset, { scope: h.eScope, params: undefined });

    expect(h.read(h.model.$values)).toEqual({ name: "init" });
    expect(h.read(h.model.$isChanged)).toBe(false);
    expect(h.read($changed)).toEqual([{ name: "init" }]);
  });

  it("clears errors that were applied before the reset", async () => {
    const h = setupForm(createForm({ schema: { email: createField("x") } }));
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { errors: { email: "bad" } },
    });
    expect(h.read(h.model.$outerErrors)).toEqual({ email: "bad" });
    await allSettled(h.model.reset, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$outerErrors)).toEqual({ email: null });
    expect(h.read(h.model.$isValid)).toBe(true);
  });
});

/* ================================================================== *
 * bridgeMethod — form.submit
 * ================================================================== */

describe("dispatch — model.submit", () => {
  const makeAgeForm = (age: number) =>
    setupForm(
      createForm({
        schema: { age: createField(age) },
        validation: (values: { age: number }) =>
          values.age >= 18 ? null : { age: "Too young" },
      }),
    );

  it("valid form: emits `submitted` + `validated` + `validatedAndSubmitted`, no `validationFailed`", async () => {
    const h = makeAgeForm(21);
    const $submitted = counter(h.model.submitted);
    const $vas = counter(h.model.validatedAndSubmitted);
    const $validated = counter(h.model.validated);
    const $failed = counter(h.model.validationFailed);
    await allSettled(h.model.submit, { scope: h.eScope, params: undefined });
    expect(h.read($submitted)).toBe(1);
    expect(h.read($vas)).toBe(1);
    expect(h.read($validated)).toBe(1);
    expect(h.read($failed)).toBe(0);
  });

  it("valid submit forces the snapshot forward so $isChanged becomes false", async () => {
    const h = makeAgeForm(21);
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { values: { age: 30 } },
    });
    expect(h.read(h.model.$isChanged)).toBe(true);
    await allSettled(h.model.submit, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$isChanged)).toBe(false);
    expect(h.read(h.model.$snapshot)).toEqual({ age: 30 });
  });

  it("invalid form: emits `submitted` + `validationFailed`, but NO `validatedAndSubmitted`", async () => {
    // NB: the core form emits `submitted` unconditionally at the start of the
    // submit reaction (before validation); only `validatedAndSubmitted` is gated
    // on validity. The dispatch bridge faithfully mirrors that.
    const h = makeAgeForm(10);
    const $submitted = counter(h.model.submitted);
    const $vas = counter(h.model.validatedAndSubmitted);
    const $failed = counter(h.model.validationFailed);
    await allSettled(h.model.submit, { scope: h.eScope, params: undefined });
    expect(h.read($submitted)).toBe(1);
    expect(h.read($failed)).toBe(1);
    expect(h.read($vas)).toBe(0);
    expect(h.read(h.model.$errors)).toEqual({ age: "Too young" });
  });
});

/* ================================================================== *
 * bridgeMethod — clearInnerErrors / clearOuterErrors / forceUpdateSnapshot
 * ================================================================== */

describe("dispatch — model.clearOuterErrors / clearInnerErrors", () => {
  const makeErroredForm = async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(10) },
        validation: (values: { age: number }) =>
          values.age >= 18 ? null : { age: "inner!" },
      }),
    );
    // inner error via validation, outer error via fill.
    await allSettled(h.model.validate, { scope: h.eScope, params: undefined });
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { errors: { age: "outer!" } },
    });
    return h;
  };

  it("`clearOuterErrors` removes the outer channel, leaving inner errors intact", async () => {
    const h = await makeErroredForm();
    expect(h.read(h.model.$outerErrors)).toEqual({ age: "outer!" });
    expect(h.read(h.model.$innerErrors)).toEqual({ age: "inner!" });
    const $errorsChanged = counter(h.model.errorsChanged);
    await allSettled(h.model.clearOuterErrors, {
      scope: h.eScope,
      params: undefined,
    });
    expect(h.read(h.model.$outerErrors)).toEqual({ age: null });
    expect(h.read(h.model.$innerErrors)).toEqual({ age: "inner!" });
    expect(h.read($errorsChanged)).toBeGreaterThanOrEqual(1);
  });

  it("`clearInnerErrors` removes the inner channel, leaving outer errors intact", async () => {
    const h = await makeErroredForm();
    await allSettled(h.model.clearInnerErrors, {
      scope: h.eScope,
      params: undefined,
    });
    expect(h.read(h.model.$innerErrors)).toEqual({ age: null });
    expect(h.read(h.model.$outerErrors)).toEqual({ age: "outer!" });
  });
});

describe("dispatch — model.forceUpdateSnapshot", () => {
  it("promotes the current values to the snapshot so $isChanged resets to false", async () => {
    const h = setupForm(createForm({ schema: { name: createField("init") } }));
    // Drift via the bridged `fill` effect (not a leaf `change.target()` event):
    // interleaving a fooled-event dispatch with a subsequent fooled-effect
    // dispatch in the same scope corrupts the virentia runtime (see bugsSuspected).
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { values: { name: "drift" } },
    });
    expect(h.read(h.model.$isChanged)).toBe(true);

    await allSettled(h.model.forceUpdateSnapshot, {
      scope: h.eScope,
      params: undefined,
    });
    expect(h.read(h.model.$isChanged)).toBe(false);
    expect(h.read(h.model.$snapshot)).toEqual({ name: "drift" });
    expect(h.read(h.model.$values)).toEqual({ name: "drift" });
  });
});

/* ================================================================== *
 * Leaf field target() — targetOf
 * ================================================================== */

describe("dispatch — leaf field target()", () => {
  it("`fields.<leaf>.change.target()` dispatches a value change into the form", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const target = h.drive(() => (h.model.fields as any).email.change.target());
    await allSettled(target, { scope: h.eScope, params: "typed@in.com" });
    expect(h.read(h.model.$values)).toEqual({ email: "typed@in.com" });
  });

  it("leaf `change.target()` updates $values but does NOT emit the form's `filled`/`changed`", async () => {
    // A direct leaf-field change bypasses `form.fill`, so the reactive `$values`
    // mirror updates while the form-level lifecycle events (which only fire from
    // `form.fill` / `form.reset`) stay silent.
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const $changed = collector<{ email: string }>(h.model.changed);
    const $filled = collector<{ email: string }>(h.model.filled);
    const target = h.drive(() => (h.model.fields as any).email.change.target());
    await allSettled(target, { scope: h.eScope, params: "watched" });
    expect(h.read(h.model.$values)).toEqual({ email: "watched" });
    expect(h.read($changed)).toEqual([]);
    expect(h.read($filled)).toEqual([]);
  });

  it("`fields.<leaf>.setOuterError.target()` sets the outer error and flips $isValid", async () => {
    const h = setupForm(createForm({ schema: { email: createField("x") } }));
    const target = h.drive(() =>
      (h.model.fields as any).email.setOuterError.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "invalid address" });
    expect(h.read(h.model.$errors)).toEqual({ email: "invalid address" });
    expect(h.read(h.model.$outerErrors)).toEqual({ email: "invalid address" });
    expect(h.read(h.model.$isValid)).toBe(false);
  });

  it("`fields.<leaf>.setInnerError.target()` sets the inner error channel and flips $isValid", async () => {
    const h = setupForm(createForm({ schema: { email: createField("x") } }));
    const target = h.drive(() =>
      (h.model.fields as any).email.setInnerError.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "inner bad" });
    expect(h.read(h.model.$innerErrors)).toEqual({ email: "inner bad" });
    expect(h.read(h.model.$outerErrors)).toEqual({ email: null });
    expect(h.read(h.model.$errors)).toEqual({ email: "inner bad" });
    expect(h.read(h.model.$isValid)).toBe(false);
  });

  it("`change.target(map)` maps external dispatch props to the unit payload", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const target = h.drive(() =>
      (h.model.fields as any).email.change.target((props: { raw: string }) =>
        props.raw.toUpperCase(),
      ),
    );
    await allSettled(target, { scope: h.eScope, params: { raw: "hi" } });
    expect(h.read(h.model.$values)).toEqual({ email: "HI" });
  });

  it("two independent leaf targets each dispatch to their own field", async () => {
    const h = setupForm(
      createForm({ schema: { a: createField(""), b: createField("") } }),
    );
    const ta = h.drive(() => (h.model.fields as any).a.change.target());
    const tb = h.drive(() => (h.model.fields as any).b.change.target());
    await allSettled(ta, { scope: h.eScope, params: "AA" });
    await allSettled(tb, { scope: h.eScope, params: "BB" });
    expect(h.read(h.model.$values)).toEqual({ a: "AA", b: "BB" });
  });
});

/* ================================================================== *
 * Collection dispatch — array field delete()
 * ================================================================== */

describe("dispatch — array field delete()", () => {
  const makeTags = (initial: readonly string[] = ["a", "b", "c"]) =>
    setupForm(createForm({ schema: { tags: createArrayField<string>(initial) } }));

  it("`where(pred).delete()` removes every matched item", async () => {
    const h = makeTags(["a", "b", "c", "b"]);
    const del = h.drive(() =>
      (h.model.fields as any).tags.where((d: any) => d.value === "b").delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "c"] });
  });

  it("`where` predicate receives each item's data as `{ value, id }`", async () => {
    const h = makeTags(["a", "b"]);
    const seen: Array<{ value: unknown; id: unknown }> = [];
    const del = h.drive(() =>
      (h.model.fields as any).tags
        .where((d: any) => {
          seen.push({ value: d.value, id: d.id });
          return false; // match nothing
        })
        .delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(seen.map((s) => s.value)).toEqual(["a", "b"]);
    expect(seen.every((s) => typeof s.id === "string")).toBe(true);
    // no match -> no-op
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "b"] });
  });

  it("`ids(id).delete()` removes only the item with that stable id", async () => {
    const h = makeTags();
    const [firstId] = h.drive(() =>
      Object.keys((h.model.fields as any).tags.getSource()),
    );
    const del = h.drive(() => (h.model.fields as any).tags.ids(firstId).delete());
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["b", "c"] });
  });

  it("`first().delete()` removes the first item", async () => {
    const h = makeTags();
    const del = h.drive(() => (h.model.fields as any).tags.first().delete());
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["b", "c"] });
  });

  it("`last().delete()` removes the last item", async () => {
    const h = makeTags();
    const del = h.drive(() => (h.model.fields as any).tags.last().delete());
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "b"] });
  });

  it("`single().delete()` deletes when exactly one item matches", async () => {
    const h = makeTags(["only"]);
    const del = h.drive(() => (h.model.fields as any).tags.single().delete());
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: [] });
  });

  it("`single().delete()` is a no-op when more than one item matches", async () => {
    const h = makeTags(["a", "b", "c"]);
    const del = h.drive(() => (h.model.fields as any).tags.single().delete());
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "b", "c"] });
  });

  it("`where(...).single().delete()` deletes the single narrowed match", async () => {
    const h = makeTags(["a", "b", "c"]);
    const del = h.drive(() =>
      (h.model.fields as any).tags
        .where((d: any) => d.value === "b")
        .single()
        .delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "c"] });
  });

  it("`delete()` with a predicate matching nothing is a no-op", async () => {
    const h = makeTags(["a", "b"]);
    const del = h.drive(() =>
      (h.model.fields as any).tags.where((d: any) => d.value === "zzz").delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "b"] });
  });

  it("`ids(...).delete()` with several ids removes all of them (end-first, indices stay valid)", async () => {
    const h = makeTags(["a", "b", "c", "d"]);
    const keys = h.drive(() =>
      Object.keys((h.model.fields as any).tags.getSource()),
    );
    const del = h.drive(() =>
      (h.model.fields as any).tags.ids(keys[0], keys[2]).delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["b", "d"] });
  });

  it("`ids(<unknown id>).delete()` matches nothing and is a no-op", async () => {
    const h = makeTags(["a", "b", "c"]);
    const del = h.drive(() =>
      (h.model.fields as any).tags.ids("no-such-id-999").delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "b", "c"] });
  });

  it("`single().delete()` is a no-op when ZERO items match (empty selection)", async () => {
    const h = makeTags(["a", "b", "c"]);
    const del = h.drive(() =>
      (h.model.fields as any).tags
        .where((d: any) => d.value === "zzz")
        .single()
        .delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "b", "c"] });
  });

  it("chained `where(...).where(...)` accumulates predicates (AND semantics)", async () => {
    const h = makeTags(["ab", "ac", "xb"]);
    const del = h.drive(() =>
      (h.model.fields as any).tags
        .where((d: any) => d.value.includes("a"))
        .where((d: any) => d.value.includes("b"))
        .delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    // only "ab" matches BOTH predicates and is removed
    expect(h.read(h.model.$values)).toEqual({ tags: ["ac", "xb"] });
  });
});

/* ================================================================== *
 * Collection dispatch — array field item target()
 * ================================================================== */

describe("dispatch — array field item target()", () => {
  const makeTags = (initial: readonly string[] = ["a", "b", "c"]) =>
    setupForm(createForm({ schema: { tags: createArrayField<string>(initial) } }));

  it("`first().change.target()` dispatches to the first item only", async () => {
    const h = makeTags();
    const target = h.drive(() =>
      (h.model.fields as any).tags.first().change.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "Z" });
    expect(h.read(h.model.$values)).toEqual({ tags: ["Z", "b", "c"] });
  });

  it("`last().change.target()` dispatches to the last item only", async () => {
    const h = makeTags();
    const target = h.drive(() =>
      (h.model.fields as any).tags.last().change.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "Z" });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "b", "Z"] });
  });

  it("`single().change.target()` dispatches to the sole item", async () => {
    const h = makeTags(["only"]);
    const target = h.drive(() =>
      (h.model.fields as any).tags.single().change.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "X" });
    expect(h.read(h.model.$values)).toEqual({ tags: ["X"] });
  });

  it("`ids(id).change.target()` dispatches to the addressed item", async () => {
    const h = makeTags();
    const keys = h.drive(() =>
      Object.keys((h.model.fields as any).tags.getSource()),
    );
    const target = h.drive(() =>
      (h.model.fields as any).tags.ids(keys[1]).change.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "MID" });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "MID", "c"] });
  });

  it("`where(pred).change.target()` dispatches to EVERY matched item", async () => {
    const h = makeTags(["a", "b", "a"]);
    const target = h.drive(() =>
      (h.model.fields as any).tags
        .where((d: any) => d.value === "a")
        .change.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "!" });
    expect(h.read(h.model.$values)).toEqual({ tags: ["!", "b", "!"] });
  });

  it("`first().change.target(map)` maps external dispatch props to the payload", async () => {
    const h = makeTags();
    const target = h.drive(() =>
      (h.model.fields as any).tags
        .first()
        .change.target((props: string) => props + "!"),
    );
    await allSettled(target, { scope: h.eScope, params: "X" });
    expect(h.read(h.model.$values)).toEqual({ tags: ["X!", "b", "c"] });
  });

  it("dispatch to a no-match selection is a no-op", async () => {
    const h = makeTags();
    const target = h.drive(() =>
      (h.model.fields as any).tags
        .where((d: any) => d.value === "nope")
        .change.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "Z" });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "b", "c"] });
  });
});

/* ================================================================== *
 * Nested dispatch — shape child + array-of-shapes item leaf
 * ================================================================== */

describe("dispatch — nested shape child leaf target()", () => {
  const makeProfile = () =>
    setupForm(
      createForm({
        schema: {
          profile: createShapeField({
            first: createField("A"),
            last: createField("B"),
          }),
        },
      }),
    );

  it("shape child is keyed by its child key, addressable via `ids(key)`", async () => {
    const h = makeProfile();
    const keys = h.drive(() =>
      Object.keys((h.model.fields as any).profile.getSource()),
    );
    expect(keys.sort()).toEqual(["first", "last"]);
    const target = h.drive(() =>
      (h.model.fields as any).profile.ids("first").change.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "Z" });
    expect(h.read(h.model.$values)).toEqual({
      profile: { first: "Z", last: "B" },
    });
  });

  it("shape child selectable by value via `where(...).change.target()`", async () => {
    const h = makeProfile();
    const target = h.drive(() =>
      (h.model.fields as any).profile
        .where((d: any) => d.value === "B")
        .change.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "W" });
    expect(h.read(h.model.$values)).toEqual({
      profile: { first: "A", last: "W" },
    });
  });
});

describe("dispatch — nested array-of-shapes item leaf target()", () => {
  const makeUsers = () =>
    setupForm(
      createForm({
        schema: {
          users: createArrayField(
            [
              { name: "Ann", age: 30 },
              { name: "Bob", age: 40 },
            ],
            {
              createItem: (v: { name: string; age: number }) =>
                createShapeField({
                  name: createField(v.name),
                  age: createField(v.age),
                }),
            },
          ),
        },
      }),
    );

  it("`first().<child>.change.target()` reaches the first item's child leaf", async () => {
    const h = makeUsers();
    const target = h.drive(() =>
      (h.model.fields as any).users.first().name.change.target(),
    );
    await allSettled(target, { scope: h.eScope, params: "Zed" });
    expect(h.read(h.model.$values)).toEqual({
      users: [
        { name: "Zed", age: 30 },
        { name: "Bob", age: 40 },
      ],
    });
  });

  it("`where(data).<child>.change.target(map)` — predicate sees the item object, map sees props", async () => {
    const h = makeUsers();
    const target = h.drive(() =>
      (h.model.fields as any).users
        .where((d: any) => d.age === 40)
        .age.change.target((props: number) => props + 1),
    );
    await allSettled(target, { scope: h.eScope, params: 100 });
    expect(h.read(h.model.$values)).toEqual({
      users: [
        { name: "Ann", age: 30 },
        { name: "Bob", age: 101 },
      ],
    });
  });

  it("`where(data).delete()` removes the matched item field", async () => {
    const h = makeUsers();
    const del = h.drive(() =>
      (h.model.fields as any).users
        .where((d: any) => d.name === "Ann")
        .delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({
      users: [{ name: "Bob", age: 40 }],
    });
  });
});

/* ================================================================== *
 * props() runtime behavior
 * ================================================================== */

describe("dispatch — props() threading", () => {
  it("`props<T>()` does not change navigation: where/delete still resolve", async () => {
    const h = setupForm(
      createForm({ schema: { tags: createArrayField<string>(["a", "b", "c"]) } }),
    );
    const del = h.drive(() =>
      (h.model.fields as any).tags
        .props()
        .where((d: any) => d.value === "b")
        .delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$values)).toEqual({ tags: ["a", "c"] });
  });

  it("BUG(pinned): the `where` predicate's props argument is always `undefined` at runtime", async () => {
    // The type-level `props<T>()` promises `where((data, props) => ...)`, but the
    // runtime `props()` never populates `config.props`, so the predicate's second
    // argument is `undefined`. Pinned as current behavior; see bugsSuspected.
    const h = setupForm(
      createForm({ schema: { tags: createArrayField<string>(["a", "b"]) } }),
    );
    let observed: unknown = "SENTINEL";
    const del = h.drive(() =>
      (h.model.fields as any).tags
        .props()
        .where((d: any, props: any) => {
          observed = props;
          return false;
        })
        .delete(),
    );
    await allSettled(del, { scope: h.eScope, params: undefined });
    expect(observed).toBeUndefined();
  });

  it("`props<T>().first().<leaf>.target(map)` still maps the dispatch params", async () => {
    const h = setupForm(
      createForm({ schema: { tags: createArrayField<string>(["a", "b"]) } }),
    );
    const target = h.drive(() =>
      (h.model.fields as any).tags
        .props()
        .first()
        .change.target((props: string) => props.repeat(2)),
    );
    await allSettled(target, { scope: h.eScope, params: "x" });
    expect(h.read(h.model.$values)).toEqual({ tags: ["xx", "b"] });
  });
});

/* ================================================================== *
 * Change-strategy forms (safe dispatch paths)
 * ================================================================== */

describe("dispatch — change-strategy forms", () => {
  it("`allSettled(validate)` on a change-strategy form still produces errors", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(5) },
        validation: (values: { age: number }) =>
          values.age >= 18 ? null : { age: "Too young" },
        validationStrategies: ["change"],
      }),
    );
    await allSettled(h.model.validate, { scope: h.eScope, params: undefined });
    expect(h.read(h.model.$errors)).toEqual({ age: "Too young" });
    expect(h.read(h.model.$isValid)).toBe(false);
  });

  it("`allSettled(fill)` on a change-strategy form validates the new values", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(21) },
        validation: (values: { age: number }) =>
          values.age >= 18 ? null : { age: "Too young" },
        validationStrategies: ["change"],
      }),
    );
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { values: { age: 5 } },
    });
    expect(h.read(h.model.$values)).toEqual({ age: 5 });
    expect(h.read(h.model.$errors)).toEqual({ age: "Too young" });
  });
});

/* ================================================================== *
 * Sequential dispatch ordering
 *
 * NB: overlapping (concurrent) `allSettled` dispatches of the same bridged
 * effect corrupt the shared virentia runtime — the cancelled run leaves the
 * global scope wedged so that every subsequent dispatch (in this and later
 * tests) is dropped. That is a @virentia/effector runtime defect (see
 * bugsSuspected), so it is intentionally NOT exercised here: doing so would
 * poison the rest of the suite. Sequentially awaited dispatches are safe and
 * deterministic, and are pinned below.
 * ================================================================== */

describe("dispatch — sequential ordering", () => {
  it("sequentially awaited `fill` dispatches apply in order (last wins)", async () => {
    const h = setupForm(createForm({ schema: { name: createField("") } }));
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { values: { name: "one" } },
    });
    expect(h.read(h.model.$values)).toEqual({ name: "one" });
    await allSettled(h.model.fill, {
      scope: h.eScope,
      params: { values: { name: "two" } },
    });
    expect(h.read(h.model.$values)).toEqual({ name: "two" });
    expect(h.drive(() => readStoreSnapshot(h.form.values))).toEqual({
      name: "two",
    });
  });
});
