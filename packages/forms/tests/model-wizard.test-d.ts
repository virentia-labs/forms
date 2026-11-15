import type { Store } from "@virentia/core";
import { staticModel, type InstanceOf } from "@virentia/core/models";
import { createField, createWizardForm, step } from "@virentia/forms";

const Signup = staticModel({ setup() { return { wizard: createWizardForm({
  schema: { email: createField(""), age: createField(0) },
  steps: [step("account", { pick: { email: true } }), step("profile", { pick: { age: true } })] as const,
}) }; } });
declare const signup: InstanceOf<typeof Signup>;
const current: Store<"account" | "profile"> = signup.wizard.currentId;
signup.wizard.goTo("profile");
// @ts-expect-error model binding preserves the declared step ids
signup.wizard.goTo("missing");
signup.wizard.form.fill({ values: { email: "typed", age: 42 } });
// @ts-expect-error root form payloads retain scalar field types
signup.wizard.form.fill({ values: { age: "42" } });
signup.wizard.steps.value[0].form.fill({ values: { email: "typed" } });
// @ts-expect-error a picked step does not acquire the next step's fields
signup.wizard.steps.value[0].form.fill({ values: { age: 42 } });
void current;
