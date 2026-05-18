import { reaction, type Event, type EventCallable, type Store, type StoreWritable } from "@virentia/core";

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

export async function tick(times = 1): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}
