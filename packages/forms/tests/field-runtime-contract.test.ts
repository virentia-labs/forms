import { getCurrentScope, owner, scope, scoped, serialize, type Effect } from "@virentia/core";
import { expect, it, vi } from "vitest";
import { createField } from "../lib";
import { deferred } from "./_helpers";

it("declares fields without a scope and keeps native unit identity and application isolation", async () => {
  expect(getCurrentScope()).toBeNull();
  const first = createField("initial"), second = createField("second");
  const a = scope(), b = scope();
  expect(first.state.node).not.toBe(second.state.node);
  expect(first.change.node).not.toBe(second.change.node);
  expect(first.state.writable).toBe(false);
  expect(scoped(a, () => first.state.filter(() => false).value)).toBeUndefined();
  expect(first.errors).toBe(first.error);
  expect(first.innerErrors).toBe(first.innerError);
  expect(first.outerErrors).toBe(first.outerError);
  await scoped(a, () => first.change("a"));
  await scoped(b, () => first.change("b"));
  expect(scoped(a, () => first.read())).toBe("a");
  expect(scoped(b, () => first.read())).toBe("b");
  expect(scoped(a, () => second.read())).toBe("second");
  expect(serialize(a)).toEqual({});
  expect(serialize(b)).toEqual({});
});

it("preserves scope handlers for a field's native fill effect", async () => {
  const field = createField("initial");
  const seen: string[] = [];
  const app = scope({ handlers: [[field.fill as Effect<string, void>, async value => { seen.push(value); }]] });
  await scoped(app, () => field.fill("intercepted"));
  expect(seen).toEqual(["intercepted"]);
  expect(scoped(app, () => field.state.value)).toBe("initial");
  const plain = scope();
  await scoped(plain, () => field.fill("normal"));
  expect(scoped(plain, () => field.state.value)).toBe("normal");
});

it("inherits a caller owner's cancellation and reaction cleanup", async () => {
  const gate = deferred<string | null>();
  let signal: AbortSignal | undefined;
  const feature = owner(() => ({ field: createField("initial", { validate(_value, ctx) {
    signal = ctx.signal;
    return gate.promise;
  } }) }));
  const app = scope();
  const validation = scoped(app, () => feature.field.validate());
  try {
    await vi.waitFor(() => expect(signal).toBeDefined());
    feature.dispose();
    expect(signal!.aborted).toBe(true);
    gate.resolve("late error");
    await validation;
    await scoped(app, () => feature.field.change("after dispose"));
    expect(scoped(app, () => feature.field.state.value)).toBe("initial");
    expect(scoped(app, () => feature.field.error.value)).toBeNull();
  } finally {
    feature.dispose(); gate.resolve(null); await validation;
  }
});

it("keeps constructor values, metadata and validators specific to each field", async () => {
  const firstInitial = { n: 1 }, secondInitial = { n: 2 };
  const firstMeta = { source: "first" }, secondMeta = { source: "second" };
  const first = createField(firstInitial, { meta: firstMeta, error: "first outer", validate: () => "first inner" });
  const second = createField(secondInitial, { meta: secondMeta, validate: () => "second inner" });
  const app = scope();
  await scoped(app, () => first.validate());
  await scoped(app, () => second.validate());
  expect(scoped(app, () => [first.innerError.value, second.innerError.value])).toEqual(["first inner", "second inner"]);
  await scoped(app, () => first.fill({ n: 10 }));
  await scoped(app, () => first.reset());
  expect(scoped(app, () => first.read())).toBe(firstInitial);
  expect(scoped(app, () => first.meta.value)).toBe(firstMeta);
  expect(scoped(app, () => first.error.value)).toBe("first outer");
  expect(scoped(app, () => second.read())).toBe(secondInitial);
  expect(scoped(app, () => second.meta.value)).toBe(secondMeta);
  expect(scoped(app, () => second.error.value)).toBe("second inner");
});
