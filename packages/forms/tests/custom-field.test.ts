import { describe, expect, it } from "vitest";
import { computed, scope, scoped } from "@virentia/core";
import {
  createField,
  createForm,
  defineField,
  normalizeField,
  readStoreSnapshot,
  type FieldContract,
} from "../lib";

describe("custom composite fields", () => {
  it("fills only the provided child, leaving the others at their defaults", async () => {
    const appScope = scope();
    const start = createField(0);
    const end = createField(10);
    const range = defineField({
      kind: "range",
      state: computed(() => ({ start: start.state.value, end: end.state.value })),
      fields: { start, end },
      async fill(next: Partial<{ start: number; end: number }>) {
        await Promise.all([
          next.start === undefined ? undefined : start.fill(next.start),
          next.end === undefined ? undefined : end.fill(next.end),
        ]);
      },
      async reset() {
        await Promise.all([start.reset(), end.reset()]);
      },
      read() {
        return { start: start.state.value, end: end.state.value };
      },
    } satisfies FieldContract<
      { start: number; end: number },
      { start: string | null; end: string | null },
      Partial<{ start: number; end: number }>
    >);
    const form = createForm({ schema: { range } });

    await scoped(appScope, async () => {
      await form.fill({ values: { range: { start: 5 } } });
      expect(readStoreSnapshot(form.values)).toEqual({ range: { start: 5, end: 10 } });
    });
  });

  it("derives the error API from its child fields", async () => {
    const appScope = scope();
    const start = createField(0);
    const end = createField(10);
    const range = defineField({
      kind: "range",
      state: computed(() => ({ start: start.state.value, end: end.state.value })),
      fields: { start, end },
      async fill(next: Partial<{ start: number; end: number }>) {
        await Promise.all([
          next.start === undefined ? undefined : start.fill(next.start),
          next.end === undefined ? undefined : end.fill(next.end),
        ]);
      },
      async reset() {
        await Promise.all([start.reset(), end.reset()]);
      },
      read() {
        return { start: start.state.value, end: end.state.value };
      },
    } satisfies FieldContract<
      { start: number; end: number },
      { start: string | null; end: string | null },
      Partial<{ start: number; end: number }>
    >);
    const normalized = normalizeField(range);

    await scoped(appScope, async () => {
      await normalized.setOuterErrors({ start: "Too early", end: null });
      expect(readStoreSnapshot(normalized.errors)).toEqual({ start: "Too early", end: null });

      await normalized.clearOuterErrors();
      expect(readStoreSnapshot(normalized.errors)).toEqual({ start: null, end: null });
    });
  });
});
