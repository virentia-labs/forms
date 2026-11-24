import { scope, scoped, store } from "@virentia/core";
import { children, staticModel } from "@virentia/core/models";
import { createForm } from "@virentia/forms";
import { fieldModel } from "@virentia/forms/models";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { zodFieldValidator, zodValidator } from "../lib";

it("validates owned field models and keeps schema dependencies in their form instance", async () => {
  const Email = fieldModel("", { validate: zodFieldValidator(z.string().email("Invalid email")) });
  const Profile = staticModel({ data: { email: children.one(Email) },
    setup(self) {
      const domain = store("example.com");
      const form = createForm({
        schema: () => ({ email: self.email.value!.field }),
        validation: zodValidator(ctx => z.object({ email: z.string().endsWith(`@${ctx.read(domain)}`, "Wrong domain") })),
        validationStrategies: ["change"],
      });
      return { domain, form };
    },
    onCreate(self) { self.email.create({}); },
  });
  const [a, b] = scoped(scope(), () => Profile.create([{}, {}]));
  try {
    await a.form.fill({ values: { email: "a@example.com" } });
    await b.form.fill({ values: { email: "b@example.com" } });
    await a.form.validate(); await b.form.validate();
    expect([a.form.isValid.value, b.form.isValid.value]).toEqual([true, true]);
    a.domain.value = "other.test";
    await vi.waitFor(() => expect(a.form.errors.value).toEqual({ email: "Wrong domain" }));
    expect(b.form.isValid.value).toBe(true);
    await a.form.fields.email.fill("invalid");
    await a.form.fields.email.validate();
    expect(a.email.value!.field.errors.value).toBe("Invalid email");
    expect(b.email.value!.field.errors.value).toBeNull();
    await a.dispose();
    await b.form.fill({ values: { email: "live@example.com" } });
    expect(b.form.isValid.value).toBe(true);
  } finally { await a.dispose(); await b.dispose(); }
});
