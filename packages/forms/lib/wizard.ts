import { computed, event, store, type Store } from "@virentia/core";
import { createForm } from "./form";
import { appendUnique, readStoreSnapshot, type AnyRecord } from "./shared";
import type {
  AnyForm,
  CreateWizardConfig,
  CreateWizardFormConfig,
  Form,
  ResolveWizardFormSteps,
  Wizard,
  WizardFormStepConfig,
  WizardFormStepInput,
  WizardFormStepSelection,
  WizardStep,
} from "./types";

export function step<Id extends string, StepForm extends AnyForm>(
  id: Id,
  config: Omit<WizardStep<Id, StepForm>, "id">,
): WizardStep<Id, StepForm>;
export function step<Id extends string, const FormInput extends true | WizardFormStepSelection>(
  id: Id,
  config: Omit<WizardFormStepConfig<Id, FormInput>, "id">,
): WizardFormStepConfig<Id, FormInput>;
export function step(
  id: string,
  config: Omit<WizardStep<string, AnyForm>, "id"> | Omit<WizardFormStepConfig<string>, "id">,
): WizardStep<string, AnyForm> | WizardFormStepConfig<string> {
  return { id, ...config } as WizardStep<string, AnyForm> | WizardFormStepConfig<string>;
}

export function createWizard<Steps extends readonly WizardStep[], RootForm extends AnyForm | undefined = undefined>(
  config: CreateWizardConfig<Steps, RootForm>,
): Wizard<Steps, RootForm> {
  if (config.steps.length === 0) {
    throw new Error("Wizard requires at least one step");
  }

  const stepsBox = store(config.steps);
  const currentIdBox = store(config.steps[0].id);
  const visitedBox = store([config.steps[0].id] as readonly Steps[number]["id"][]);
  const completedBox = store([] as readonly Steps[number]["id"][]);
  const stepsStore = computed(() => stepsBox.value);
  const visibleSteps = computed(() => filterVisibleSteps(stepsBox.value) as Steps);
  const currentStep = computed(() => {
    const visible = readStoreSnapshot(visibleSteps);
    return visible.find((item) => item.id === currentIdBox.value) ?? visible[0] ?? stepsBox.value[0];
  });
  const currentId = computed(() => readStoreSnapshot(currentStep).id);
  const currentIndex = computed(() =>
    readStoreSnapshot(visibleSteps).findIndex((item) => item.id === readStoreSnapshot(currentId)),
  );
  const currentForm = computed(() => readStoreSnapshot(currentStep).form);
  const visitedIds = computed(() => visitedBox.value);
  const completedIds = computed(() => completedBox.value);
  const canGoBack = computed(() => readStoreSnapshot(currentIndex) > 0);
  const canGoNext = computed(() => readStoreSnapshot(currentIndex) < readStoreSnapshot(visibleSteps).length - 1);
  const changed = event<Steps[number]["id"]>("wizard.changed");
  const completed = event<unknown>("wizard.completed");

  async function next(): Promise<boolean> {
    const visible = readStoreSnapshot(visibleSteps);
    const index = readStoreSnapshot(currentIndex);

    if (index < 0 || index >= visible.length - 1) {
      return false;
    }

    const current = visible[index];
    const valid = await validateStep(current);

    if (!valid) {
      return false;
    }

    markCompleted(current.id);
    await setCurrent(visible[index + 1].id);
    return true;
  }

  async function back(): Promise<boolean> {
    const visible = readStoreSnapshot(visibleSteps);
    const index = readStoreSnapshot(currentIndex);

    if (index <= 0) {
      return false;
    }

    await setCurrent(visible[index - 1].id);
    return true;
  }

  async function goTo(id: Steps[number]["id"]): Promise<boolean> {
    const visible = readStoreSnapshot(visibleSteps);
    const currentIndexValue = readStoreSnapshot(currentIndex);
    const targetIndex = visible.findIndex((item) => item.id === id);

    if (targetIndex < 0) {
      return false;
    }

    if (targetIndex > currentIndexValue) {
      for (let index = currentIndexValue; index < targetIndex; index += 1) {
        const valid = await validateStep(visible[index]);

        if (!valid) {
          return false;
        }

        markCompleted(visible[index].id);
      }
    }

    await setCurrent(id);
    return true;
  }

  async function complete(): Promise<boolean> {
    for (const current of readStoreSnapshot(visibleSteps)) {
      const valid = await validateStep(current);

      if (!valid) {
        await setCurrent(current.id);
        return false;
      }

      markCompleted(current.id);
    }

    await completed(read());
    return true;
  }

  async function reset(): Promise<void> {
    if (config.form) {
      await config.form.reset();
    } else {
      await Promise.all(stepsBox.value.map((item) => item.form.reset()));
    }

    completedBox.value = [];
    visitedBox.value = [stepsBox.value[0].id];
    currentIdBox.value = stepsBox.value[0].id;
    await changed(currentIdBox.value);
  }

  return {
    kind: "wizard",
    form: config.form as RootForm,
    steps: stepsStore as Store<Steps>,
    visibleSteps: visibleSteps as Store<Steps>,
    currentId: currentId as Store<Steps[number]["id"]>,
    currentIndex,
    currentStep: currentStep as Store<Steps[number]>,
    currentForm: currentForm as Store<Steps[number]["form"]>,
    visitedIds,
    completedIds,
    canGoBack,
    canGoNext,
    changed,
    completed,
    next,
    back,
    goTo,
    complete,
    reset,
    read,
  };

  function filterVisibleSteps(steps: readonly WizardStep[]): readonly WizardStep[] {
    const values = config.form ? config.form.read() : undefined;

    return steps.filter((item) => !item.when || item.when({ values }));
  }

  async function validateStep(current: WizardStep): Promise<boolean> {
    await current.form.validate();
    return readStoreSnapshot(current.form.isValid);
  }

  async function setCurrent(id: Steps[number]["id"]): Promise<void> {
    currentIdBox.value = id;
    visitedBox.value = appendUnique(visitedBox.value, id);
    await changed(id);
  }

  function markCompleted(id: Steps[number]["id"]): void {
    completedBox.value = appendUnique(completedBox.value, id);
  }

  function read(): unknown {
    if (config.form) {
      return config.form.read();
    }

    return Object.fromEntries(stepsBox.value.map((item) => [item.id, item.form.read()]));
  }
}

export function createWizardForm<
  Schema extends AnyRecord,
  StepsInput extends readonly WizardFormStepInput<Schema>[],
>(
  config: CreateWizardFormConfig<Schema, StepsInput>,
): Wizard<ResolveWizardFormSteps<Schema, StepsInput>, Form<Schema> & AnyForm> & {
  readonly form: Form<Schema>;
} {
  const form = createForm(config as any) as Form<Schema>;
  const stepInputs = typeof config.steps === "function" ? config.steps(form) : config.steps;
  const steps = resolveWizardFormSteps(form, stepInputs);
  const wizard = createWizard({ form: form as Form<Schema> & AnyForm, steps });

  return Object.assign(wizard, { form });
}

function resolveWizardFormSteps<
  Schema extends AnyRecord,
  StepsInput extends readonly WizardFormStepInput<Schema>[],
>(
  form: Form<Schema>,
  steps: StepsInput,
): ResolveWizardFormSteps<Schema, StepsInput> {
  return steps.map((item) => resolveWizardFormStep(form, item)) as ResolveWizardFormSteps<
    Schema,
    StepsInput
  >;
}

function resolveWizardFormStep<Schema extends AnyRecord>(
  form: Form<Schema>,
  stepInput: WizardFormStepInput<Schema>,
): WizardStep {
  if ("pick" in stepInput) {
    const { pick, ...stepConfig } = stepInput;

    return {
      ...stepConfig,
      form: form.pick(pick as never),
    };
  }

  const formInput = stepInput.form;

  if (isFormLike(formInput)) {
    return stepInput as WizardStep;
  }

  const { form: _formInput, ...stepConfig } = stepInput;

  if (formInput === true) {
    return {
      ...stepConfig,
      form,
    };
  }

  if (formInput && typeof formInput === "object") {
    return {
      ...stepConfig,
      form: form.pick(formInput as never),
    };
  }

  throw new Error("Wizard form step requires a form or pick");
}

function isFormLike(value: unknown): value is AnyForm {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { kind?: unknown }).kind === "form" &&
      "validate" in value &&
      "read" in value,
  );
}
