import { effect, type Store } from "@virentia/core";
import { children, refs, staticModel, type InstanceOf } from "@virentia/core/models";
import { createForm, type CreateFormConfig, type Field, type ValidationPayload } from "@virentia/forms";
import { fieldModel } from "@virentia/forms/models";

declare const legacyConfig: CreateFormConfig<{ email: string }>;
const legacyEmail: string = legacyConfig.schema.email;

const Email = fieldModel("", { meta: { label: "Email" }, validate(value) {
  const text: string = value;
  // @ts-expect-error scalar validator input remains a string
  const number: number = value;
  return text.includes("@") ? null : "Invalid";
} });
declare const email: InstanceOf<typeof Email>;
const field: Field<string, { label: string }> = email.field;
const meta: Store<{ label: string }> = email.field.meta;
email.field.fill("value");
// @ts-expect-error field payload is inferred from the initial value
email.field.fill(1);
email.value.value = "typed";
// @ts-expect-error model DTO/store also keeps the scalar type
email.value.value = 1;

const Form = staticModel({
  data: { email: children.one(Email) },
  setup(self) {
    const form = createForm({ schema: () => ({ email: self.email.value!.field }) });
    const values: Store<{ email: string }> = form.values;
    form.fields.email.fill("value");
    // @ts-expect-error schema resolver preserves the full Field payload type
    form.fields.email.fill(2);
    form.fill({ values: { email: "value" } });
    // @ts-expect-error form values keep their scalar types
    form.fill({ values: { email: 2 } });
    return { form };
  },
});
const Editor = staticModel({
  data: { email: refs.one(Email).policy("nullify") },
  setup(self) {
    const form = createForm({ schema: () => self.email.value ? { email: self.email.value.field } : {} });
    form.fields.email?.fill("optional");
    // @ts-expect-error optional referenced fields retain their payload type
    form.fields.email?.fill(2);
    return { form };
  },
});

const validate = effect<ValidationPayload<string>, string | null>(() => null);
fieldModel("", { validate });
void [field, meta, Form, Editor, legacyEmail];
