import { describe, expect, it } from "vitest";
import { computed, scope, scoped } from "@virentia/core";
import {
  createField,
  createForm,
  defineField,
  fieldType,
  normalizeField,
  readStoreSnapshot,
  type FieldContract,
} from "../lib";

describe("custom fields", () => {
  it("accepts plain objects that satisfy the field contract", async () => {
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

  it("derives missing error APIs from child fields", async () => {
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

  it("lets fieldType.extend compose a richer API", async () => {
    const appScope = scope();
    const primitive = fieldType({ create: createField });
    const trimmed = primitive.extend({
      create(base, initial: string) {
        const field = base(initial);

        return defineField({
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

        return defineField({
          ...field,
          kind: "uppercased",
          async uppercase() {
            await field.fill((field.read?.() as string).toUpperCase());
          },
        });
      },
    });
    const title = uppercased("  virentia  ");

    await scoped(appScope, async () => {
      await title.normalize();
      expect(title.state.value).toBe("virentia");

      await title.uppercase();
      expect(title.state.value).toBe("VIRENTIA");
    });
  });
});
