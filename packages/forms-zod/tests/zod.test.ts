import { describe, expect, it } from "vitest";
import { scope, scoped, store } from "@virentia/core";
import { createArrayField, createField, createForm, readStoreSnapshot } from "@virentia/forms";
import { z } from "zod";
import { zodFieldValidator, zodValidator } from "../lib";

async function tick(times = 1): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("@virentia/forms-zod", () => {
  it("maps nested and array issues into form errors", async () => {
    const appScope = scope();
    const form = createForm({
      schema: {
        age: 0,
        tags: createArrayField<string>([]),
        profile: {
          email: "",
        },
      },
      validation: zodValidator(
        z.object({
          age: z.number().min(18, "Too young"),
          tags: z.array(z.string()).min(2, "At least two tags"),
          profile: z.object({
            email: z.string().email("Invalid email"),
          }),
        }),
      ),
    });

    await scoped(appScope, async () => {
      await form.validate();

      expect(readStoreSnapshot(form.errors)).toEqual({
        age: "Too young",
        tags: "At least two tags",
        profile: { email: "Invalid email" },
      });
    });
  });

  it("clears stale errors when change validation reruns", async () => {
    const appScope = scope();
    const form = createForm({
      schema: {
        a: "",
        b: "",
      },
      validation: zodValidator(
        z.object({
          a: z.string().min(2, "min 2"),
          b: z.string().min(4, "min 4"),
        }),
      ),
      validationStrategies: ["change"],
    });

    await scoped(appScope, async () => {
      await form.fill({ values: { a: "a", b: "a" } });
      expect(readStoreSnapshot(form.errors)).toEqual({ a: "min 2", b: "min 4" });

      await form.fill({ values: { a: "aa" } });
      expect(readStoreSnapshot(form.errors)).toEqual({ a: null, b: "min 4" });
    });
  });

  it("supports object refine errors", async () => {
    const appScope = scope();
    const form = createForm({
      schema: {
        password: "",
        confirm: "",
      },
      validation: zodValidator(
        z
          .object({
            password: z.string(),
            confirm: z.string(),
          })
          .refine((value) => value.password === value.confirm, {
            message: "Passwords do not match",
            path: ["confirm"],
          }),
      ),
      validationStrategies: ["change"],
    });

    await scoped(appScope, async () => {
      await form.fill({ values: { password: "secret", confirm: "nope" } });
      expect(readStoreSnapshot(form.errors)).toEqual({
        password: null,
        confirm: "Passwords do not match",
      });

      await form.fill({ values: { confirm: "secret" } });
      expect(readStoreSnapshot(form.errors)).toEqual({ password: null, confirm: null });
    });
  });

  it("supports discriminated unions", async () => {
    const appScope = scope();
    const form = createForm({
      schema: {
        name: "",
        contractType: "a" as "a" | "b",
        contractId: "",
      },
      validation: zodValidator(
        z.discriminatedUnion("contractType", [
          z.object({
            name: z.string().min(1, "Name required"),
            contractType: z.literal("a"),
            contractId: z.literal("", { error: "Should be empty" }),
          }),
          z.object({
            name: z.string().min(1, "Name required"),
            contractType: z.literal("b"),
            contractId: z.string().min(1, "Contract id required"),
          }),
        ]),
      ),
      validationStrategies: ["change"],
    });

    await scoped(appScope, async () => {
      await form.fill({ values: { name: "Test", contractType: "a", contractId: "123" } });
      expect(readStoreSnapshot(form.errors)).toEqual({
        name: null,
        contractType: null,
        contractId: "Should be empty",
      });

      await form.fill({ values: { contractType: "b" } });
      expect(readStoreSnapshot(form.errors)).toEqual({
        name: null,
        contractType: null,
        contractId: null,
      });
    });
  });

  it("keeps first zod issue for a field", async () => {
    const appScope = scope();
    const form = createForm({
      schema: { email: "" },
      validation: zodValidator(
        z.object({
          email: z.string().min(2, "invalid length").email("invalid email"),
        }),
      ),
    });

    await scoped(appScope, async () => {
      await form.fill({ values: { email: "1" } });
      await form.validate();

      expect(readStoreSnapshot(form.errors).email).toBe("invalid length");
    });
  });

  it("validates a single field", async () => {
    const appScope = scope();
    const field = createField("", {
      validate: zodFieldValidator(z.string().min(2, "min 2")),
    });

    await scoped(appScope, async () => {
      await field.validate();
      expect(field.error.value).toBe("min 2");

      await field.fill("ok");
      await field.validate();
      expect(field.error.value).toBe(null);
    });
  });

  it("schema factories can subscribe to Virentia stores through ctx.read", async () => {
    const appScope = scope();
    const maxLength = store(3);
    const form = createForm({
      schema: { name: "Ada" },
      validation: zodValidator((ctx) =>
        z.object({
          name: z.string().max(ctx.read(maxLength), "Too long"),
        }),
      ),
    });

    await scoped(appScope, async () => {
      await form.validate();
      expect(readStoreSnapshot(form.errors)).toEqual({ name: null });

      maxLength.value = 2;
      await tick(100);
      expect(readStoreSnapshot(form.errors)).toEqual({ name: "Too long" });
    });
  });
});
