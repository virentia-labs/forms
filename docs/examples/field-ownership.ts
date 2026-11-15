// Executable ownership example, not an implementation of the full Forms API.
import { computed, effect } from "@virentia/core";
import { children, f, refs, staticModel, trait } from "@virentia/core/models";

export function declareFieldOwnershipExample(options: {
  onValueSetup?: () => void;
  onRulesSetup?: () => void;
  check?: (value: string, signal: AbortSignal) => Promise<void>;
} = {}) {
  const TextValue = trait({
    data: { value: f.string(""), focused: f.boolean(false).local() },
    setup(self) {
      options.onValueSetup?.();
      const fill = effect<string, void>(value => { self.value.value = value; });
      const focus = effect(() => { self.focused.value = true; });
      return { state: computed(() => self.value.value), fill, focus };
    },
  });

  const EmailRules = trait({
    requires: { value: f.string() },
    setup(self) {
      options.onRulesSetup?.();
      const error = computed(() => self.value.value.includes("@") ? null : "Use a valid email");
      const check = effect(async (_: void, { signal }) => {
        await options.check?.(self.value.value, signal);
      });
      return { error, check, isChecking: check.pending };
    },
  });

  // One concrete definition and one unit graph for every Email instance.
  const Email = staticModel({ name: "DocsEmail", with: [TextValue, EmailRules] });

  const ownedForm = (name: string) => staticModel({
    name,
    data: { email: children.one(Email) },
    setup(self) {
      return { values: computed(() => ({ email: self.email.value?.state.value ?? "" })) };
    },
    onCreate(self) {
      // A DTO may already contain a hydrated child. Do not replace it.
      if (!self.email.value) self.email.create({});
    },
  });

  const Signup = ownedForm("DocsSignup");
  const Recovery = ownedForm("DocsRecovery");
  const SharedDraft = ownedForm("DocsSharedDraft");
  const LinkedForm = staticModel({
    name: "DocsLinkedForm",
    data: { email: refs.one(Email).policy("nullify") },
    setup(self) {
      return { values: computed(() => ({ email: self.email.value?.state.value ?? "" })) };
    },
  });

  return { Email, Signup, Recovery, SharedDraft, LinkedForm };
}
