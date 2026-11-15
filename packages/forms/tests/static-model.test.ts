import { scope, scoped, store } from "@virentia/core";
import { staticModel } from "@virentia/core/models";
import { expect, it, vi } from "vitest";
import { createField } from "../lib";

it("isolates fields and validation dependencies between staticModel instances", async () => {
  let setups = 0;
  const validated: string[] = [];
  const Field = staticModel({
    setup() {
      setups++;
      const expected = store("");
      const field = createField("", {
        validate(value, ctx) {
          validated.push(value);
          return value === ctx.read(expected) ? null : "Mismatch";
        },
      });
      return {
        expected,
        change: field.change,
        validate: field.validate,
        state: field.state,
        error: field.error,
      };
    },
  });
  const app = scope();
  const [a, b] = scoped(app, () => Field.create([{ id: "a" }, { id: "b" }]));
  try {
    expect(setups).toBe(1);
    expect(a.state.node).toBe(b.state.node);
    a.expected.value = "first";
    b.expected.value = "second";
    await a.change("first");
    await b.change("second");
    await a.validate();
    await b.validate();
    expect([a.error.value, b.error.value]).toEqual([null, null]);

    a.expected.value = "changed";
    await vi.waitFor(() => expect(a.error.value).toBe("Mismatch"));
    expect(b.error.value).toBeNull();
    expect(validated).toEqual(["first", "second", "first"]);

    await a.dispose();
    b.expected.value = "changed";
    await vi.waitFor(() => expect(b.error.value).toBe("Mismatch"));
    expect(validated).toEqual(["first", "second", "first", "second"]);

    const reused = scoped(app, () => Field.create({ id: "a" }));
    try {
      expect(reused.state.value).toBe("");
      expect(reused.error.value).toBeNull();
      reused.expected.value = "fresh";
      expect(validated).toHaveLength(4);
      expect(b.state.value).toBe("second");
    } finally {
      await reused.dispose();
    }
  } finally {
    await a.dispose();
    await b.dispose();
  }
});
