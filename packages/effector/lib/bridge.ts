import {
  effect as virentiaEffect,
  getCurrentScope,
  scope as createScope,
  scoped,
  type Scope,
  type Store as VirentiaStore,
} from "@virentia/core";
import { ensureAssociation, fool } from "@virentia/effector";
import { toEffectorUnit } from "@virentia/effector/internal";
import { applicationScopeOf } from "@virentia/core/internal";
import { readStoreSnapshot } from "@virentia/forms";
import {
  createStore,
  allSettled,
  type Effect as EffectorEffect,
  type Event as EffectorEvent,
  type EventCallable as EffectorEventCallable,
  type Store as EffectorStore,
} from "effector";
import type { AnyVirentiaUnit } from "./types";

/**
 * Read a virentia store's current value without an ambient scope. Reads happen
 * inside a throwaway scope, which yields the store's base value — enough to seed
 * the mirrored effector store's initial state. Matches how `createForm` snapshots
 * its initial values (`scoped(createScope(), () => ...)`).
 */
export function readInitial<T>(store: VirentiaStore<T>): T {
  return scoped(createScope(), () => readStoreSnapshot(store));
}

/**
 * Mirror a virentia store as a readable effector store. Fooling a virentia store
 * yields an effector event that fires on every store update; we seed a fresh
 * effector store with the current value and drive it from that event.
 */
export function bridgeStore<T>(store: VirentiaStore<T>): EffectorStore<T> {
  const updates = fool(store) as unknown as EffectorEvent<T>;
  return createStore<T>(readInitial(store)).on(updates, (_, next) => next);
}

/**
 * Mirror a virentia output event as an effector event.
 */
export function bridgeEvent<T>(event: AnyVirentiaUnit): EffectorEvent<T> {
  return fool(event as never) as unknown as EffectorEvent<T>;
}

/**
 * Mirror an event-callable / effect as a targetable effector unit.
 */
export function bridgeCallable<T>(unit: AnyVirentiaUnit): EffectorEventCallable<T> {
  return fool(unit as never) as unknown as EffectorEventCallable<T>;
}

/**
 * Wrap an arbitrary async form/field method (which may be a plain async function
 * rather than a virentia unit) in a virentia effect and foolit into an effector
 * effect. When the effector effect runs, `fool` resolves the associated virentia
 * scope and executes the handler there, so the wrapped method sees the right
 * scope via `requireCurrentScope()`.
 */
export function bridgeMethod<Payload, Done = void>(
  run: (payload: Payload) => Promise<Done> | Done,
  name?: string,
): EffectorEffect<Payload, Done> {
  return bridgeScopedMethod(run, name);
}

/** Internal fixed-model variant; ordinary forms remain usable in many apps. */
export function bridgeScopedMethod<Payload, Done = void>(
  run: (payload: Payload) => Promise<Done> | Done,
  name?: string,
  home?: Scope,
): EffectorEffect<Payload, Done> {
  const application = home && applicationScopeOf(home);
  const fx = virentiaEffect<Payload, Done, Error>(
    async (payload: Payload, { scope }) => {
      if (application && applicationScopeOf(scope) !== application)
        throw new Error("Form belongs to another associated application");
      return await run(payload);
    },
    name,
  );
  const projected = toEffectorUnit(fx);
  // Effector launches via graphite. Direct calls from Core enter the paired
  // Effector fork too, so pending/lifecycle and the returned result agree.
  const callable = (payload: Payload): Promise<Done> => {
    const current = getCurrentScope();
    if (!current) return projected(payload);
    const association = ensureAssociation({ virentia: applicationScopeOf(current) });
    return scoped(current, () => allSettled(projected, { scope: association.effector, params: payload }).then(result => {
      if (result.status === "fail") throw result.value;
      return result.value;
    }));
  };
  return Object.defineProperties(callable, Object.getOwnPropertyDescriptors(projected)) as EffectorEffect<Payload, Done>;
}
