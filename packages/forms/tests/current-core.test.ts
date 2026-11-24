import { computed, getCurrentScope, reactive, scope, scoped, store, type Store } from "@virentia/core";
import { describe, expect, it, vi } from "vitest";
import { createField, readStoreSnapshot } from "../lib";
import { deferred } from "./_helpers";

describe("current Core compatibility", () => {
  it("reads native value stores and computeds without reflecting their implementation", () => {
    const app = scope();
    const values = [undefined, null, false, 0, "", { value: 7 }, [1, 2], new Date(0)];
    scoped(app, () => {
      for (const value of values) {
        expect(readStoreSnapshot(store(value))).toBe(value);
        expect(readStoreSnapshot(computed(() => value))).toBe(value);
      }
    });
  });

  it("distinguishes a reactive payload named value from a boxed value", () => {
    scoped(scope(), () => {
      const state = reactive({ value: 7 });
      // Structural reactive adapters are supported by the snapshot helper too.
      expect(readStoreSnapshot(state as unknown as Store<{ value: number }>)).toEqual({ value: 7 });
      state.value = 9;
      expect(readStoreSnapshot(state as unknown as Store<{ value: number }>)).toEqual({ value: 9 });
      expect(readStoreSnapshot({ value: 3 } as Store<number>)).toBe(3);
    });
  });

  it("resumes each validator and commits its result in the original application", async () => {
    const label = store("first");
    const first = scope(), second = scope({ values: [[label, "second"]] });
    const gates = { first: deferred<null>(), second: deferred<null>() };
    const entered: string[] = [], resumed: string[] = [];
    const field = createField("", {
      validate: [
        (_value, ctx) => {
          const name = ctx.read(label) as keyof typeof gates;
          entered.push(name);
          return gates[name].promise;
        },
        (_value, ctx) => {
          const name = ctx.read(label);
          expect(getCurrentScope()).toBe(name === "first" ? first : second);
          resumed.push(name);
          return name === "first" ? "Required" : null;
        },
      ],
    });
    const previous = getCurrentScope();
    const a = scoped(first, () => field.validate());
    const b = scoped(second, () => field.validate());
    await vi.waitFor(() => expect(entered).toHaveLength(2));
    gates.second.resolve(null);
    await b;
    gates.first.resolve(null);
    await a;
    expect(resumed).toEqual(["second", "first"]);
    expect(scoped(first, () => field.error.value)).toBe("Required");
    expect(scoped(second, () => field.error.value)).toBeNull();
    expect(getCurrentScope()).toBe(previous);
  });
});
