import {
  createArrayField,
  createField,
  createForm,
  createWizard,
  createWizardForm,
  step,
  type FieldError,
  type NormalizeSchema,
} from "@virentia/forms";
import {
  useField,
  useForm,
  useWizard,
  useWizardForm,
  type FieldView,
  type FormView,
  type WizardView,
} from "../lib";

// ---------------------------------------------------------------------------
// Type-test harness (see repo CLAUDE.md). These files are verified ONLY by
// `pnpm typecheck` — vitest never runs them — so every assertion is a
// TYPE-level fact and every `@ts-expect-error` must guard a real error.
// ---------------------------------------------------------------------------
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

// ===========================================================================
// useField — a plain string field
// The lead requirement: useField(createField("x")) resolves the
// NormalizedField overload to FieldView<string, FieldError, string>.
// ===========================================================================
{
  const view = useField(createField("x"));

  // Whole-view type: proves overload #1 (NormalizedField) was selected, NOT the
  // fallback overload #2 that would degrade to FieldView<unknown, unknown, unknown>.
  type _view = Expect<Equal<typeof view, FieldView<string, FieldError, string>>>;

  // value / error stores are read as concrete scalars.
  type _value = Expect<Equal<typeof view.value, string>>;
  type _errors = Expect<Equal<typeof view.errors, FieldError>>;
  type _innerErrors = Expect<Equal<typeof view.innerErrors, FieldError>>;
  type _outerErrors = Expect<Equal<typeof view.outerErrors, FieldError>>;
  type _isValid = Expect<Equal<typeof view.isValid, boolean>>;
  type _isPending = Expect<Equal<typeof view.isValidationPending, boolean>>;
  // `view` (the field's custom render descriptor) is passed through as unknown.
  type _viewProp = Expect<Equal<typeof view.view, unknown>>;
  // The underlying normalized field is exposed unchanged.
  type _field = Expect<
    Equal<typeof view.field, ReturnType<typeof useField<string, FieldError, string>>["field"]>
  >;

  // fill takes the field Value and resolves to void.
  type _fillParams = Expect<Equal<Parameters<typeof view.fill>, [string]>>;
  type _fillReturn = Expect<Equal<ReturnType<typeof view.fill>, Promise<void>>>;

  // The remaining scoped methods keep their promise-void signatures.
  type _reset = Expect<Equal<ReturnType<typeof view.reset>, Promise<void>>>;
  type _validate = Expect<Equal<ReturnType<typeof view.validate>, Promise<void>>>;
  type _setInner = Expect<Equal<Parameters<typeof view.setInnerErrors>, [FieldError]>>;
  type _setOuter = Expect<Equal<Parameters<typeof view.setOuterErrors>, [FieldError]>>;
  type _clearInner = Expect<Equal<ReturnType<typeof view.clearInnerErrors>, Promise<void>>>;
  type _clearOuter = Expect<Equal<ReturnType<typeof view.clearOuterErrors>, Promise<void>>>;

  // A well-typed fill call is accepted.
  view.fill("hello");

  // @ts-expect-error — value is a string; not assignable to a number.
  const _wrongScalar: number = view.value;
  // @ts-expect-error — value is a string; not assignable to a boolean.
  const _wrongScalar2: boolean = view.value;
  // @ts-expect-error — fill requires a string payload, not a number.
  view.fill(123);
  // @ts-expect-error — fill requires a string payload, not a boolean.
  view.fill(true);
  // @ts-expect-error — setInnerErrors takes FieldError (string | null), not a number.
  view.setInnerErrors(123);
  // @ts-expect-error — setOuterErrors takes FieldError (string | null), not a number.
  view.setOuterErrors(123);
}

// ===========================================================================
// useField — a numeric field (generic inference flows through the hook)
// ===========================================================================
{
  const view = useField(createField(5));

  type _view = Expect<Equal<typeof view, FieldView<number, FieldError, number>>>;
  type _value = Expect<Equal<typeof view.value, number>>;
  type _fillParams = Expect<Equal<Parameters<typeof view.fill>, [number]>>;

  // @ts-expect-error — a number-field value is not assignable to string.
  const _wrong: string = view.value;
  // @ts-expect-error — a number field rejects a string fill.
  view.fill("nope");
}

// ===========================================================================
// useField — a boolean field
// ===========================================================================
{
  const view = useField(createField(false));

  type _view = Expect<Equal<typeof view, FieldView<boolean, FieldError, boolean>>>;
  type _value = Expect<Equal<typeof view.value, boolean>>;

  // @ts-expect-error — a boolean value is not assignable to number.
  const _wrong: number = view.value;
  // @ts-expect-error — a boolean field rejects a numeric fill.
  view.fill(1);
}

// ===========================================================================
// useField — a structured (object) value field
// ===========================================================================
{
  const view = useField(createField<{ n: number }>({ n: 0 }));

  type _value = Expect<Equal<typeof view.value, { n: number }>>;
  type _fillParams = Expect<Equal<Parameters<typeof view.fill>, [{ n: number }]>>;

  view.fill({ n: 1 });

  // @ts-expect-error — fill needs the object shape, not a bare number.
  view.fill(1);
  // @ts-expect-error — the object value is not assignable to a scalar.
  const _wrong: string = view.value;
}

// ===========================================================================
// useField — WILD input: an array field.
// Value becomes readonly Value[]; Errors widens to the ArrayFieldErrors union.
// ===========================================================================
{
  const view = useField(createArrayField<string>([]));

  type _value = Expect<Equal<typeof view.value, readonly string[]>>;
  // ArrayFieldErrors<FieldError> === FieldError | readonly FieldError[]
  type _errors = Expect<Equal<typeof view.errors, FieldError | readonly FieldError[]>>;
  type _fillParams = Expect<Equal<Parameters<typeof view.fill>, [readonly string[]]>>;

  view.fill(["a", "b"]);

  // @ts-expect-error — array field fill needs a string array, not a number.
  view.fill(5);
  // @ts-expect-error — an array value is not assignable to a bare string.
  const _wrong: string = view.value;
}

// ===========================================================================
// useForm — view mirrors the form's own field/fill types.
// ===========================================================================
{
  const form = createForm({ schema: { name: "", age: 0, tags: [] as string[] } });
  const view = useForm(form);

  // Whole-view type is FormView keyed on the concrete form.
  type _view = Expect<Equal<typeof view, FormView<typeof form>>>;
  type _form = Expect<Equal<typeof view.form, typeof form>>;

  // fields === form.fields type (and the normalized schema it expands to).
  type _fields = Expect<Equal<typeof view.fields, typeof form.fields>>;
  type _fieldsNormalized = Expect<
    Equal<typeof view.fields, NormalizeSchema<{ name: string; age: number; tags: string[] }>>
  >;

  // fill === form.fill type.
  type _fill = Expect<Equal<typeof view.fill, typeof form.fill>>;
  type _fillReturn = Expect<Equal<ReturnType<typeof view.fill>, Promise<void>>>;

  // Boolean state stores are read as plain booleans.
  type _isChanged = Expect<Equal<typeof view.isChanged, boolean>>;
  type _isValid = Expect<Equal<typeof view.isValid, boolean>>;
  type _isPending = Expect<Equal<typeof view.isValidationPending, boolean>>;

  // Snapshot-shaped reads are intentionally erased to `unknown` on the view
  // (callers cast them; only fields/fill carry the schema types).
  type _values = Expect<Equal<typeof view.values, unknown>>;
  type _errors = Expect<Equal<typeof view.errors, unknown>>;
  type _innerErrors = Expect<Equal<typeof view.innerErrors, unknown>>;
  type _outerErrors = Expect<Equal<typeof view.outerErrors, unknown>>;
  type _snapshot = Expect<Equal<typeof view.snapshot, unknown>>;

  // Command methods keep promise-void signatures.
  type _reset = Expect<Equal<ReturnType<typeof view.reset>, Promise<void>>>;
  type _validate = Expect<Equal<ReturnType<typeof view.validate>, Promise<void>>>;
  type _submit = Expect<Equal<ReturnType<typeof view.submit>, Promise<void>>>;
  type _clearInner = Expect<Equal<ReturnType<typeof view.clearInnerErrors>, Promise<void>>>;
  type _clearOuter = Expect<Equal<ReturnType<typeof view.clearOuterErrors>, Promise<void>>>;
  type _force = Expect<Equal<ReturnType<typeof view.forceUpdateSnapshot>, Promise<void>>>;

  // A partial-recursive fill payload is accepted.
  view.fill({ values: { name: "ada", age: 3 } });
  view.fill({ values: { tags: ["x"] } });

  // @ts-expect-error — age must be a number.
  view.fill({ values: { age: "not a number" } });
  // @ts-expect-error — `nope` is not a schema key.
  view.fill({ values: { nope: true } });
  // @ts-expect-error — errors for `name` must be FieldError, not a number.
  view.fill({ errors: { name: 123 } });
}

// ===========================================================================
// useForm — negatives: the argument MUST be a Form.
// ===========================================================================
{
  // @ts-expect-error — a field is not a Form.
  useForm(createField("x"));
  // @ts-expect-error — an array field is not a Form.
  useForm(createArrayField<string>([]));
  // @ts-expect-error — a wizard is not a Form.
  useForm(createWizard({ steps: [step("a", { form: createForm({ schema: { a: "" } }) })] }));
  // @ts-expect-error — a number is not a Form.
  useForm(123);
  // @ts-expect-error — a bare string is not a Form.
  useForm("form");
  // @ts-expect-error — an empty object is not a Form.
  useForm({});
}

// ===========================================================================
// useWizard — navigation methods and index types.
// ===========================================================================
{
  const a = createForm({ schema: { a: "" } });
  const b = createForm({ schema: { b: "" } });
  const wizard = createWizard({ steps: [step("a", { form: a }), step("b", { form: b })] });
  const view = useWizard(wizard);

  type _view = Expect<Equal<typeof view, WizardView<typeof wizard>>>;
  type _wizard = Expect<Equal<typeof view.wizard, typeof wizard>>;

  // currentIndex is a plain number.
  type _currentIndex = Expect<Equal<typeof view.currentIndex, number>>;

  // canGoBack / canGoNext are plain booleans.
  type _canBack = Expect<Equal<typeof view.canGoBack, boolean>>;
  type _canNext = Expect<Equal<typeof view.canGoNext, boolean>>;

  // Snapshot-shaped reads are erased to `unknown` on the view; id lists stay arrays.
  type _currentId = Expect<Equal<typeof view.currentId, unknown>>;
  type _currentStep = Expect<Equal<typeof view.currentStep, unknown>>;
  type _currentForm = Expect<Equal<typeof view.currentForm, unknown>>;
  type _steps = Expect<Equal<typeof view.steps, unknown>>;
  type _visibleSteps = Expect<Equal<typeof view.visibleSteps, unknown>>;
  type _visitedIds = Expect<Equal<typeof view.visitedIds, readonly unknown[]>>;
  type _completedIds = Expect<Equal<typeof view.completedIds, readonly unknown[]>>;

  // next / back / complete resolve to a boolean; reset to void.
  type _next = Expect<Equal<ReturnType<typeof view.next>, Promise<boolean>>>;
  type _nextParams = Expect<Equal<Parameters<typeof view.next>, []>>;
  type _back = Expect<Equal<ReturnType<typeof view.back>, Promise<boolean>>>;
  type _backParams = Expect<Equal<Parameters<typeof view.back>, []>>;
  type _complete = Expect<Equal<ReturnType<typeof view.complete>, Promise<boolean>>>;
  type _completeParams = Expect<Equal<Parameters<typeof view.complete>, []>>;
  type _reset = Expect<Equal<ReturnType<typeof view.reset>, Promise<void>>>;

  // BUG PIN (react-goto-never): WizardView["goTo"] declares its parameter as
  // `never`, so from the view goTo is effectively uncallable — even a valid
  // step id is rejected. Pinned as current behavior via the full declared shape
  // `(id: never) => Promise<boolean>` and a `[never]` param list. (We pin the
  // whole signature rather than ReturnType<> because the built-in ReturnType<>
  // utility is unreliable on never-parameter functions.)
  type _goToSig = Expect<Equal<typeof view.goTo, (id: never) => Promise<boolean>>>;
  type _goToParams = Expect<Equal<Parameters<typeof view.goTo>, [never]>>;

  // @ts-expect-error — next() takes no arguments.
  view.next("a");
  // @ts-expect-error — back() takes no arguments.
  view.back(1);
  // @ts-expect-error — complete() takes no arguments.
  view.complete(true);
  // @ts-expect-error — goTo's param is `never`; even a real step id is rejected.
  view.goTo("a");
}

// ===========================================================================
// useWizardForm — alias of useWizard, returns the same WizardView.
// ===========================================================================
{
  // The alias is literally the same function value/type as useWizard.
  type _sameFn = Expect<Equal<typeof useWizardForm, typeof useWizard>>;

  const wizardForm = createWizardForm({
    schema: { email: "", name: "" },
    steps: [
      step("account", { pick: { email: true } }),
      step("profile", { form: { name: true } }),
    ],
  });
  const view = useWizardForm(wizardForm);

  type _view = Expect<Equal<typeof view, WizardView<typeof wizardForm>>>;
  type _currentIndex = Expect<Equal<typeof view.currentIndex, number>>;
  type _next = Expect<Equal<ReturnType<typeof view.next>, Promise<boolean>>>;
  type _back = Expect<Equal<ReturnType<typeof view.back>, Promise<boolean>>>;
  type _complete = Expect<Equal<ReturnType<typeof view.complete>, Promise<boolean>>>;
  type _reset = Expect<Equal<ReturnType<typeof view.reset>, Promise<void>>>;

  // @ts-expect-error — next() takes no arguments.
  view.next(1);
}
