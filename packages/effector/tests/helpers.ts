import { scope as virentiaScope, scoped, type Scope } from "@virentia/core";
import { associate } from "@virentia/effector";
import { fork, type Scope as EffectorScope } from "effector";
import { formToEffector } from "../lib";
import type { Form } from "@virentia/forms";
import type { EffectorForm } from "../lib/types";

export interface Harness<Schema extends Record<string, any>> {
  form: Form<Schema>;
  model: EffectorForm<Schema>;
  vScope: Scope;
  eScope: EffectorScope;
  /** Run a virentia-side action (the form is the source of truth) in the paired scope. */
  drive<T>(fn: () => T): T;
  /** Read the current effector-scope value of a bridged store. */
  read<T>(store: { __t?: T } | any): any;
}

/**
 * Pair a virentia scope with a forked effector scope, build the effector model
 * inside the virentia scope (the bridge reads computeds on creation, which needs
 * an active scope), and return handles for driving/reading both sides.
 */
export function setupForm<Schema extends Record<string, any>>(
  form: Form<Schema>,
): Harness<Schema> {
  const vScope = virentiaScope();
  const eScope = fork();
  associate({ virentia: vScope, effector: eScope });
  const model = scoped(vScope, () => formToEffector(form));
  return {
    form,
    model,
    vScope,
    eScope,
    drive: (fn) => scoped(vScope, fn),
    read: (store) => eScope.getState(store),
  };
}
