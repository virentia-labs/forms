import { scope, scoped, setErrorReporter, type VirentiaFailureReport } from "@virentia/core";
import { children, staticModel } from "@virentia/core/models";
import { expect, it, vi } from "vitest";
import { createForm } from "../lib";
import { arrayFieldModel, fieldModel, shapeFieldModel } from "../lib/models";
import { deferred } from "./_helpers";

it("consumes the disposed model's own automatic validation cancellation and keeps a sibling active", async () => {
  const Text = fieldModel("initial"), Item = shapeFieldModel({ text: Text });
  const Items = arrayFieldModel([{ text: "initial" }], { item: Item });
  const gate = deferred<void>();
  const seen: string[] = [], reports: VirentiaFailureReport[] = [];
  const Model = staticModel({
    data: { items: children.one(Items) },
    setup(self) { return { form: createForm({
      schema: () => ({ items: self.items.value!.field }),
      validation: async values => {
        seen.push(values.items[0]!.text);
        if (values.items[0]!.text === "wait") await gate.promise;
        return null;
      },
      validationStrategies: ["change"],
    }) }; },
    onCreate(self) { self.items.create({}); },
  });
  const [a, b] = scoped(scope(), () => Model.create([{}, {}]));
  setErrorReporter(report => reports.push(report));
  try {
    await a.items.value!.field.items.value[0]!.fields.value.text.fill("wait");
    await vi.waitFor(() => expect(seen).toContain("wait"));
    await a.dispose();
    gate.resolve();
    await b.form.fill({ values: { items: [{ text: "live" }] } });
    await vi.waitFor(() => expect(b.form.isValidationPending.value).toBe(false));
    expect(b.form.values.value.items).toEqual([{ text: "live" }]);
    expect(reports).toEqual([]);
  } finally {
    gate.resolve(); await a.dispose(); await b.dispose(); setErrorReporter(null);
  }
});

it("still rejects an explicitly awaited validation failure", async () => {
  const Text = fieldModel(""), failure = new Error("validator failure");
  const Model = staticModel({
    data: { text: children.one(Text) },
    setup(self) { return { form: createForm({
      schema: () => ({ text: self.text.value!.field }),
      validation() { throw failure; },
    }) }; },
    onCreate(self) { self.text.create({}); },
  });
  const instance = scoped(scope(), () => Model.create({}));
  const reports: VirentiaFailureReport[] = [];
  setErrorReporter(report => reports.push(report));
  try {
    await expect(instance.form.validate()).rejects.toBe(failure);
    expect(reports.some(report => report.error === failure)).toBe(true);
  } finally { await instance.dispose(); setErrorReporter(null); }
});
