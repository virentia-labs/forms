import { children, staticModel } from "@virentia/core/models";
import { createForm, createWizard, step } from "@virentia/forms";
import { fieldModel } from "@virentia/forms/models";

const Email = fieldModel("", { name: "GuideWizardEmail", validate: value => value.includes("@") ? null : "Invalid email" });
const DisplayName = fieldModel("", { name: "GuideWizardDisplayName" });

export const Signup = staticModel({
  name: "GuideWizardSignup",
  data: { email: children.one(Email), displayName: children.one(DisplayName) },
  setup(self) {
    const form = createForm({ schema: () => ({
      email: self.email.value!.field,
      name: self.displayName.value!.field,
    }) });
    const wizard = createWizard({ form, steps: [
      step("account", { form: form.pick({ email: true }) }),
      step("profile", { form: form.pick({ name: true }) }),
      step("review", { form }),
    ] as const });
    return { wizard };
  },
  onCreate(self) {
    if (!self.email.value) self.email.create({});
    if (!self.displayName.value) self.displayName.create({});
  },
});
