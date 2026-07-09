import { describe, expect, it } from "vitest";
import { createArrayField, createField, createForm } from "@virentia/forms";
import { createStore, type Event } from "effector";
import { setupForm } from "./helpers";

describe("formToEffector — top-level state (virentia → effector mirror)", () => {
  it("seeds $values / $value from the form's initial values", () => {
    const { model, read } = setupForm(
      createForm({ schema: { email: createField("a@b.c"), age: createField(21) } }),
    );
    expect(read(model.$values)).toEqual({ email: "a@b.c", age: 21 });
    expect(read(model.$value)).toEqual({ email: "a@b.c", age: 21 });
  });

  it("mirrors $values after a form.fill on the virentia side", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    await h.drive(() => h.form.fill({ values: { email: "next@x.y" } }));
    expect(h.read(h.model.$values)).toEqual({ email: "next@x.y" });
  });

  it("mirrors $errors and flips $isValid after validation fails", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(16) },
        validation: (values: { age: number }) =>
          values.age >= 18 ? null : { age: "Too young" },
      }),
    );
    await h.drive(() => h.form.validate());
    expect(h.read(h.model.$errors)).toEqual({ age: "Too young" });
    expect(h.read(h.model.$isValid)).toBe(false);
  });

  it("mirrors $isChanged as the form drifts from its snapshot", async () => {
    const h = setupForm(createForm({ schema: { name: createField("initial") } }));
    expect(h.read(h.model.$isChanged)).toBe(false);
    await h.drive(() => h.form.fill({ values: { name: "changed" } }));
    expect(h.read(h.model.$isChanged)).toBe(true);
  });
});

describe("formToEffector — lifecycle events (virentia → effector)", () => {
  it("emits `changed` into the effector scope on a fill", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const $log = createStore<any[]>([]).on(h.model.changed, (log, v) => [...log, v]);
    await h.drive(() => h.form.fill({ values: { email: "z@z.z" } }));
    expect(h.read($log)).toEqual([{ email: "z@z.z" }]);
  });

  it("emits `validationFailed` (not `validated`) when validation fails", async () => {
    const h = setupForm(
      createForm({
        schema: { age: createField(10) },
        validation: (values: { age: number }) =>
          values.age >= 18 ? null : { age: "Too young" },
      }),
    );
    const $ok = createStore(0).on(h.model.validated, (n) => n + 1);
    const $fail = createStore(0).on(h.model.validationFailed, (n) => n + 1);
    await h.drive(() => h.form.validate());
    expect(h.read($ok)).toBe(0);
    expect(h.read($fail)).toBe(1);
  });
});

describe("formToEffector — field lens (watch via clock)", () => {
  it("`fields.email.state.clock()` fires on the effector side when the field changes", async () => {
    const h = setupForm(createForm({ schema: { email: createField("") } }));
    const clock = h.drive(() => (h.model.fields as any).email.state.clock()) as Event<string>;
    const $seen = createStore<string[]>([]).on(clock, (log, v) => [...log, v]);
    await h.drive(() => h.form.fill({ values: { email: "watched" } }));
    expect(h.read($seen)).toContain("watched");
  });
});

describe("formToEffector — collection lens (array field, read side)", () => {
  const makeTags = () =>
    setupForm(
      createForm({
        schema: { tags: createArrayField<string>(["a", "b", "c"]) },
      }),
    );

  it("`getSource()` returns the current items keyed by stable id", () => {
    const h = makeTags();
    const source = h.drive(() => (h.model.fields as any).tags.getSource());
    expect(Object.keys(source)).toHaveLength(3);
  });

  it("assigns a stable id per item that is consistent across reads", () => {
    const h = makeTags();
    const first = h.drive(() => (h.model.fields as any).tags.getSource());
    const second = h.drive(() => (h.model.fields as any).tags.getSource());
    // Same underlying item instances -> identical ids on every read.
    expect(Object.keys(second)).toEqual(Object.keys(first));
    expect(Object.keys(first)).toHaveLength(3);
  });

  it("`ids(...)` narrows the collection to the requested stable ids", () => {
    const h = makeTags();
    const [firstId] = h.drive(() => Object.keys((h.model.fields as any).tags.getSource()));
    const narrowed = h.drive(() =>
      Object.keys((h.model.fields as any).tags.ids(firstId).getSource()),
    );
    expect(narrowed).toEqual([firstId]);
  });
});

/**
 * Dispatch direction — effector → virentia — now covered.
 *
 * Driving the bridged methods from the effector side (`allSettled(model.fill, …)`)
 * and the lens `target()` / `delete()` dispatchers works against the current
 * `@virentia/effector` runtime: a fooled virentia effect executes inside the
 * associated virentia scope when triggered from effector. Full exhaustive
 * coverage of this direction lives in `effector-dispatch.exhaustive.test.ts`
 * (allSettled fill/validate/reset/submit/clear, leaf `target(map)`, collection
 * `where().delete()` / `ids().delete()` / `first()/last()/single()`).
 */
