import { describe, expect, it } from "vitest";
import { effect, scope, scoped, store } from "@virentia/core";
import {
  createArrayField,
  createField,
  readStoreSnapshot,
  type ValidationContext,
  type ValidationPayload,
} from "../lib";
import { deferred, tick, watchCalls } from "./_helpers";

describe("validation", () => {
  it("accepts Virentia effects and passes value, ctx and abort signal", async () => {
    const appScope = scope();
    const forbidden = store("taken");
    const seenSignals: AbortSignal[] = [];
    const validateFx = effect<ValidationPayload<string>, string | null>(
      (payload: ValidationPayload<string>, { signal }: { signal: AbortSignal }) => {
      seenSignals.push(signal);
      expect(payload.ctx.signal).toBeInstanceOf(AbortSignal);
      expect(signal).toBeInstanceOf(AbortSignal);
      return payload.value === payload.ctx.read(forbidden) ? "Already taken" : null;
      },
    );
    const field = createField("taken", {
      validate: validateFx,
    });

    await scoped(appScope, async () => {
      await field.validate();

      expect(field.error.value).toBe("Already taken");
      expect(seenSignals).toHaveLength(1);
      expect(seenSignals[0].aborted).toBe(false);
    });
  });

  it("uses effect handlers from the current Virentia scope", async () => {
    const validateFx = effect<ValidationPayload<string>, string | null>(() => "Default handler");
    const firstScope = scope();
    const secondScope = scope({
      handlers: [[validateFx, () => null]],
    });
    const field = createField("", { validate: validateFx });

    await scoped(firstScope, async () => {
      await field.validate();
      expect(field.error.value).toBe("Default handler");
    });
    await scoped(secondScope, async () => {
      await field.validate();
      expect(field.error.value).toBe(null);
    });
  });

  it("aborts the previous async validation run", async () => {
    const appScope = scope();
    const slow = deferred<string | null>();
    const fast = deferred<string | null>();
    const abortedValues: string[] = [];
    const field = createField<string>("slow", {
      validate(value: string, ctx: ValidationContext) {
        if (value === "slow") {
          ctx.signal.addEventListener(
            "abort",
            () => {
              abortedValues.push(value);
              slow.resolve("Stale error");
            },
            { once: true },
          );
          return slow.promise;
        }

        return fast.promise;
      },
    });

    await scoped(appScope, async () => {
      const first = field.validate();
      await tick();
      await field.fill("fast");
      const second = field.validate();

      fast.resolve(null);
      await second;
      await first;

      expect(abortedValues).toEqual(["slow"]);
      expect(field.error.value).toBe(null);
    });
  });

  it("revalidates array-level dependencies while preserving item errors", async () => {
    const appScope = scope();
    const minItems = store(2);
    const tags = createArrayField([""], {
      createItem(value) {
        return createField(value, {
          validate: (next: string) => (next ? null : "Tag required"),
        });
      },
      validate(values: readonly string[], ctx: ValidationContext) {
        return values.length >= ctx.read(minItems) ? null : "Too few tags";
      },
    });

    await scoped(appScope, async () => {
      await tags.validate();
      expect(readStoreSnapshot(tags.errors)).toBe("Too few tags");

      minItems.value = 1;
      // Pump the queue for the dependency-driven revalidation while keeping the
      // ambient scope: a raw `await tick` is not a unit await and would drop the
      // scope, so run it through `scoped`.
      await scoped(() => tick(100));
      expect(readStoreSnapshot(tags.errors)).toEqual(["Tag required"]);
    });
  });

  it("runs all validators until the first semantic error", async () => {
    const appScope = scope();
    const calls: string[] = [];
    const field = createField("value", {
      validate: [
        () => {
          calls.push("null");
          return null;
        },
        () => {
          calls.push("undefined");
          return undefined;
        },
        () => {
          calls.push("error");
          return "Error";
        },
        () => {
          calls.push("after");
          return "After";
        },
      ],
    });

    await scoped(appScope, async () => {
      await field.validate();

      expect(field.error.value).toBe("Error");
      expect(calls).toEqual(["null", "undefined", "error"]);
    });
  });

  it("sets pending flags while async validation is running", async () => {
    const appScope = scope();
    const pending = deferred<string | null>();
    const field = createField("value", {
      validate: () => pending.promise,
    });
    const pendingCalls = watchCalls(field.isValidationPending);

    await scoped(appScope, async () => {
      const validation = field.validate();
      await tick();

      expect(field.isValidationPending.value).toBe(true);
      pending.resolve(null);
      await validation;

      expect(field.isValidationPending.value).toBe(false);
      expect(pendingCalls.at(-1)).toBe(false);
    });
  });
});
