import {
  createField,
  createForm,
  createWizard,
  createWizardForm,
  step,
  type Form,
  type Wizard,
  type WizardStep,
} from "@virentia/forms";
import type { Event, Store } from "@virentia/core";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// step()
// ---------------------------------------------------------------------------
{
  const form = createForm({ schema: { a: "" } });
  const s = step("a", { form });
  type _id = Expect<Equal<typeof s.id, "a">>;
  type _step = Expect<Equal<typeof s, WizardStep<"a", typeof form>>>;
  type _form = Expect<Equal<typeof s.form, typeof form>>;
  // title/when are optional members of WizardStep
  type _title = Expect<Equal<typeof s.title, string | undefined>>;

  // form must be an actual form (or the true|selection config shape).
  // @ts-expect-error - a number is neither a form nor a selection config
  step("a", { form: 123 });

  // createWizardForm config shape: { pick }
  const picked = step("a", { pick: { email: true } });
  type _pickId = Expect<Equal<typeof picked.id, "a">>;
}

// ---------------------------------------------------------------------------
// createWizard return type + store/method payloads
// ---------------------------------------------------------------------------
{
  const a = createForm({ schema: { a: "" } });
  const b = createForm({ schema: { b: "" } });
  const wizard = createWizard({ steps: [step("a", { form: a }), step("b", { form: b })] });

  type _kind = Expect<Equal<typeof wizard.kind, "wizard">>;
  // standalone -> RootForm is undefined
  type _form = Expect<Equal<typeof wizard.form, undefined>>;

  // id-typed stores are unions of the step ids
  type _currentId = Expect<Equal<typeof wizard.currentId, Store<"a" | "b">>>;
  type _visited = Expect<Equal<typeof wizard.visitedIds, Store<readonly ("a" | "b")[]>>>;
  type _completed = Expect<Equal<typeof wizard.completedIds, Store<readonly ("a" | "b")[]>>>;
  type _currentIndex = Expect<Equal<typeof wizard.currentIndex, Store<number>>>;
  type _canBack = Expect<Equal<typeof wizard.canGoBack, Store<boolean>>>;
  type _canNext = Expect<Equal<typeof wizard.canGoNext, Store<boolean>>>;

  // events
  type _changed = Expect<Equal<typeof wizard.changed, Event<"a" | "b">>>;
  type _completedEv = Expect<Equal<typeof wizard.completed, Event<unknown>>>;

  // navigation method signatures
  type _next = Expect<Equal<ReturnType<typeof wizard.next>, Promise<boolean>>>;
  type _back = Expect<Equal<ReturnType<typeof wizard.back>, Promise<boolean>>>;
  type _complete = Expect<Equal<ReturnType<typeof wizard.complete>, Promise<boolean>>>;
  type _reset = Expect<Equal<ReturnType<typeof wizard.reset>, Promise<void>>>;
  type _read = Expect<Equal<ReturnType<typeof wizard.read>, unknown>>;
  type _goTo = Expect<Equal<ReturnType<typeof wizard.goTo>, Promise<boolean>>>;

  // goTo accepts a valid step id
  wizard.goTo("a");
  wizard.goTo("b");
  // @ts-expect-error - "c" is not a step id
  wizard.goTo("c");
  // @ts-expect-error - next() takes no arguments
  wizard.next("a");
  // @ts-expect-error - changed carries an id, not a number
  wizard.changed.watch((id: number) => id);

  // steps is required
  // @ts-expect-error - steps missing
  createWizard({});
}

// ---------------------------------------------------------------------------
// createWizard with a root form -> RootForm is the form type
// ---------------------------------------------------------------------------
{
  const root = createForm({ schema: { email: "" } });
  const wizard = createWizard({
    form: root,
    steps: [step("a", { form: root.pick({ email: true }) })],
  });
  type _form = Expect<Equal<typeof wizard.form, typeof root>>;
}

// ---------------------------------------------------------------------------
// createWizardForm return type carries a Form<Schema> on .form
// ---------------------------------------------------------------------------
{
  const wizard = createWizardForm({
    schema: {
      email: createField("", { validate: (v: string) => (v ? null : "Email required") }),
      name: "",
    },
    steps: (form) => [
      step("account", { form: form.pick({ email: true }) }),
      step("profile", { form: form.pick({ name: true }) }),
    ],
  });

  type _kind = Expect<Equal<typeof wizard.kind, "wizard">>;
  // .form is a Form (not undefined) built from the schema
  type _isForm = Expect<Equal<(typeof wizard.form)["kind"], "form">>;
  const _f: Form<{ email: ReturnType<typeof createField>; name: string }> = wizard.form;
  void _f;

  type _next = Expect<Equal<ReturnType<typeof wizard.next>, Promise<boolean>>>;
  type _read = Expect<Equal<ReturnType<typeof wizard.read>, unknown>>;
}

// ---------------------------------------------------------------------------
// createWizardForm with an array of step configs (pick / form:true / form:object)
// ---------------------------------------------------------------------------
{
  const wizard = createWizardForm({
    schema: { email: "", name: "" },
    steps: [
      step("account", { pick: { email: true } }),
      step("profile", { form: { name: true } }),
      step("review", { form: true }),
    ],
  });
  type _isWizard = Expect<Equal<typeof wizard.kind, "wizard">>;

  // steps is required on the config
  // @ts-expect-error - steps missing
  createWizardForm({ schema: { email: "" } });
}

// Wizard is assignable to the generic Wizard interface.
{
  const wizard = createWizard({ steps: [step("a", { form: createForm({ schema: { a: "" } }) })] });
  const generic: Wizard = wizard;
  void generic;
}
