import {
  effect as virentiaEffect,
  scope as createScope,
  scoped,
  type Store as VirentiaStore,
} from "@virentia/core";
import { fool } from "@virentia/effector";
import { readStoreSnapshot } from "@virentia/forms";
import {
  createStore,
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
  const fx = virentiaEffect<Payload, Done>(
    async (payload: Payload) => await run(payload),
    name,
  );
  return fool(fx) as unknown as EffectorEffect<Payload, Done>;
}
