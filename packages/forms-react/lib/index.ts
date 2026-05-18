import { scoped, type Scope, type Store, type StoreWritable } from "@virentia/core";
import {
  normalizeField,
  readStoreSnapshot,
  type AnyField,
  type Form,
  type NormalizedField,
  type Wizard,
} from "@virentia/forms";
import { useProvidedScope } from "@virentia/react";
import { useCallback, useRef, useSyncExternalStore } from "react";

export interface FieldView<Value, Errors, Fill> {
  readonly field: NormalizedField<Value, Errors, Fill>;
  readonly value: Value;
  readonly errors: Errors;
  readonly innerErrors: Errors;
  readonly outerErrors: Errors;
  readonly isValid: boolean;
  readonly isValidationPending: boolean;
  readonly view: unknown;
  fill(payload: Fill): Promise<void>;
  reset(): Promise<void>;
  validate(): Promise<void>;
  setInnerErrors(errors: Errors): Promise<void>;
  setOuterErrors(errors: Errors): Promise<void>;
  clearInnerErrors(): Promise<void>;
  clearOuterErrors(): Promise<void>;
}

export interface FormView<Model extends Form> {
  readonly form: Model;
  readonly fields: Model["fields"];
  readonly values: unknown;
  readonly errors: unknown;
  readonly innerErrors: unknown;
  readonly outerErrors: unknown;
  readonly snapshot: unknown;
  readonly isChanged: boolean;
  readonly isValid: boolean;
  readonly isValidationPending: boolean;
  fill: Model["fill"];
  reset(): Promise<void>;
  validate(): Promise<void>;
  submit(): Promise<void>;
  clearInnerErrors(): Promise<void>;
  clearOuterErrors(): Promise<void>;
  forceUpdateSnapshot(): Promise<void>;
}

export interface WizardView<Model extends Wizard> {
  readonly wizard: Model;
  readonly steps: unknown;
  readonly visibleSteps: unknown;
  readonly currentId: unknown;
  readonly currentIndex: number;
  readonly currentStep: unknown;
  readonly currentForm: unknown;
  readonly visitedIds: readonly unknown[];
  readonly completedIds: readonly unknown[];
  readonly canGoBack: boolean;
  readonly canGoNext: boolean;
  next(): Promise<boolean>;
  back(): Promise<boolean>;
  goTo(id: never): Promise<boolean>;
  complete(): Promise<boolean>;
  reset(): Promise<void>;
}

export function useField<Value, Errors, Fill>(
  field: NormalizedField<Value, Errors, Fill>,
): FieldView<Value, Errors, Fill>;
export function useField<Value, Errors, Fill>(
  field: {
    readonly [Key in keyof AnyField]: AnyField[Key];
  } & AnyField,
): FieldView<Value, Errors, Fill>;
export function useField(field: AnyField): FieldView<unknown, unknown, unknown> {
  const scope = useProvidedScope();
  const normalized = normalizeField(field);
  const value = useStoreSnapshot(normalized.state, scope);
  const errors = useStoreSnapshot(normalized.errors, scope);
  const innerErrors = useStoreSnapshot(normalized.innerErrors, scope);
  const outerErrors = useStoreSnapshot(normalized.outerErrors, scope);
  const isValid = useStoreSnapshot(normalized.isValid, scope);
  const isValidationPending = useStoreSnapshot(normalized.isValidationPending, scope);

  return {
    field: normalized,
    value,
    errors,
    innerErrors,
    outerErrors,
    isValid,
    isValidationPending,
    view: normalized.view,
    fill: useScopedMethod(scope, normalized.fill),
    reset: useScopedMethod(scope, normalized.reset),
    validate: useScopedMethod(scope, normalized.validate),
    setInnerErrors: useScopedMethod(scope, normalized.setInnerErrors),
    setOuterErrors: useScopedMethod(scope, normalized.setOuterErrors),
    clearInnerErrors: useScopedMethod(scope, normalized.clearInnerErrors),
    clearOuterErrors: useScopedMethod(scope, normalized.clearOuterErrors),
  };
}

export function useForm<Model extends Form>(form: Model): FormView<Model> {
  const scope = useProvidedScope();
  const values = useStoreSnapshot(form.values, scope);
  const errors = useStoreSnapshot(form.errors, scope);
  const innerErrors = useStoreSnapshot(form.innerErrors, scope);
  const outerErrors = useStoreSnapshot(form.outerErrors, scope);
  const snapshot = useStoreSnapshot(form.snapshot, scope);
  const isChanged = useStoreSnapshot(form.isChanged, scope);
  const isValid = useStoreSnapshot(form.isValid, scope);
  const isValidationPending = useStoreSnapshot(form.isValidationPending, scope);

  return {
    form,
    fields: form.fields,
    values,
    errors,
    innerErrors,
    outerErrors,
    snapshot,
    isChanged,
    isValid,
    isValidationPending,
    fill: useScopedMethod(scope, form.fill) as Model["fill"],
    reset: useScopedMethod(scope, form.reset),
    validate: useScopedMethod(scope, form.validate),
    submit: useScopedMethod(scope, form.submit),
    clearInnerErrors: useScopedMethod(scope, form.clearInnerErrors),
    clearOuterErrors: useScopedMethod(scope, form.clearOuterErrors),
    forceUpdateSnapshot: useScopedMethod(scope, form.forceUpdateSnapshot),
  };
}

export function useWizard<Model extends Wizard>(wizard: Model): WizardView<Model> {
  const scope = useProvidedScope();
  const steps = useStoreSnapshot(wizard.steps, scope);
  const visibleSteps = useStoreSnapshot(wizard.visibleSteps, scope);
  const currentId = useStoreSnapshot(wizard.currentId, scope);
  const currentIndex = useStoreSnapshot(wizard.currentIndex, scope);
  const currentStep = useStoreSnapshot(wizard.currentStep, scope);
  const currentForm = useStoreSnapshot(wizard.currentForm, scope);
  const visitedIds = useStoreSnapshot(wizard.visitedIds, scope);
  const completedIds = useStoreSnapshot(wizard.completedIds, scope);
  const canGoBack = useStoreSnapshot(wizard.canGoBack, scope);
  const canGoNext = useStoreSnapshot(wizard.canGoNext, scope);

  return {
    wizard,
    steps,
    visibleSteps,
    currentId,
    currentIndex,
    currentStep,
    currentForm,
    visitedIds,
    completedIds,
    canGoBack,
    canGoNext,
    next: useScopedMethod(scope, wizard.next),
    back: useScopedMethod(scope, wizard.back),
    goTo: useScopedMethod(scope, wizard.goTo) as WizardView<Model>["goTo"],
    complete: useScopedMethod(scope, wizard.complete),
    reset: useScopedMethod(scope, wizard.reset),
  };
}

export const useWizardForm = useWizard;

function useScopedMethod<Fn extends (...args: any[]) => any>(scope: Scope, fn: Fn): Fn {
  return useCallback(
    ((...args: Parameters<Fn>) => scoped(scope, () => fn(...args))) as Fn,
    [scope, fn],
  );
}

function useStoreSnapshot<T>(unit: Store<T> | StoreWritable<T>, scope: Scope): T {
  const read = useCallback(() => scoped(scope, () => readStoreSnapshot(unit)), [scope, unit]);
  const snapshotRef = useRef(read());

  snapshotRef.current = read();

  const subscribe = useCallback(
    (notify: () => void) => {
      const unsubscribe = unit.subscribe((_value, nextScope) => {
        if (nextScope !== scope) {
          return;
        }

        snapshotRef.current = read();
        notify();
      });

      snapshotRef.current = read();

      return unsubscribe;
    },
    [read, scope, unit],
  );

  return useSyncExternalStore(
    subscribe,
    () => snapshotRef.current,
    () => snapshotRef.current,
  );
}
