import { getCurrentScope, reaction, scoped, type Event, type EventCallable, type Store, type StoreWritable } from "@virentia/core";

type Watchable<T> = Event<T> | EventCallable<T> | Store<T> | StoreWritable<T>;

export function watchCalls<T>(unit: Watchable<T>): T[] {
  const calls: T[] = [];

  reaction({
    on: unit as Event<T>,
    run(payload) {
      calls.push(payload);
    },
  });

  return calls;
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

export function tick(times = 1): Promise<void> {
  const scope = getCurrentScope();
  const wait = async () => {
    for (let index = 0; index < times; index += 1) await Promise.resolve();
  };
  // Test waits deliberately resume the caller's scope. A plain native promise
  // is an external boundary and does not carry the kernel's async context.
  return scope ? scoped(scope, wait) : wait();
}
