import { describe, expect, it } from "vitest";
import {
  effect,
  getCurrentScope,
  scope,
  scoped,
  store,
} from "@virentia/core";
import {
  createField,
  readStoreSnapshot,
  type ValidationContext,
  type ValidationPayload,
} from "../lib";
import { deferred, tick, watchCalls } from "./_helpers";

describe("createField", () => {
  // ---------------------------------------------------------------------------
  // A.1 Construction
  // ---------------------------------------------------------------------------
  describe("construction", () => {
    it("seeds default state, null errors, empty meta and idle flags", async () => {
      const appScope = scope();
      const field = createField("Ada");

      expect(field.kind).toBe("field");

      await scoped(appScope, async () => {
        expect(field.state.value).toBe("Ada");
        expect(field.innerError.value).toBe(null);
        expect(field.outerError.value).toBe(null);
        expect(field.error.value).toBe(null);
        expect(readStoreSnapshot(field.meta)).toEqual({});
        expect(field.isFocused.value).toBe(false);
        expect(field.isValid.value).toBe(true);
        expect(field.isValidationPending.value).toBe(false);
        expect(field.read()).toBe("Ada");
        expect(field.readFields()).toEqual({});
        expect(field.serialize!()).toEqual({ value: "Ada", errors: null });
      });
    });

    it("seeds outerError from options.error and reflects it in error/isValid", async () => {
      const appScope = scope();
      const field = createField("", { error: "Seed" });

      await scoped(appScope, async () => {
        expect(field.outerError.value).toBe("Seed");
        expect(field.innerError.value).toBe(null);
        expect(field.error.value).toBe("Seed");
        expect(field.isValid.value).toBe(false);
      });
    });

    it("uses the provided meta object", async () => {
      const appScope = scope();
      const field = createField("x", { meta: { touched: true, id: 7 } });

      await scoped(appScope, async () => {
        expect(readStoreSnapshot(field.meta)).toEqual({ touched: true, id: 7 });
      });
    });

    it("accepts a single function, an array of functions, an effect and an array of effects", async () => {
      const appScope = scope();
      const single = createField("", { validate: (v: string) => (v ? null : "R") });
      const many = createField("", {
        validate: [() => null, () => "Second"],
      });
      const fx = effect<ValidationPayload<string>, string | null>(() => "FxError");
      const effField = createField("", { validate: fx });
      const fxA = effect<ValidationPayload<string>, string | null>(() => null);
      const fxB = effect<ValidationPayload<string>, string | null>(() => "FxB");
      const effArrayField = createField("", { validate: [fxA, fxB] });

      await scoped(appScope, async () => {
        await single.validate();
        expect(single.error.value).toBe("R");

        await many.validate();
        expect(many.error.value).toBe("Second");

        await effField.validate();
        expect(effField.error.value).toBe("FxError");

        await effArrayField.validate();
        expect(effArrayField.error.value).toBe("FxB");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A.2 Value
  // ---------------------------------------------------------------------------
  describe("value", () => {
    it("writes state and emits changed in order via fill", async () => {
      const appScope = scope();
      const field = createField("a");
      const changed = watchCalls(field.changed);

      await scoped(appScope, async () => {
        await field.fill("b");
        expect(field.state.value).toBe("b");
        await field.fill("c");
        expect(changed).toEqual(["b", "c"]);
      });
    });

    it("treats change() as fill (same state write + changed emit)", async () => {
      const appScope = scope();
      const field = createField("a");
      const changed = watchCalls(field.changed);

      await scoped(appScope, async () => {
        await field.change("z");
        expect(field.state.value).toBe("z");
        expect(field.read()).toBe("z");
        expect(changed).toEqual(["z"]);
      });
    });

    it("re-emits changed even when the value is unchanged (idempotent state, non-idempotent event)", async () => {
      const appScope = scope();
      const field = createField(0);
      const changed = watchCalls(field.changed);

      await scoped(appScope, async () => {
        await field.fill(0);
        await field.fill(0);
        expect(field.state.value).toBe(0);
        expect(changed).toEqual([0, 0]);
      });
    });

    it("handles falsy and structured values", async () => {
      const appScope = scope();
      const boolField = createField(true);
      const objField = createField<{ n: number }>({ n: 1 });

      await scoped(appScope, async () => {
        await boolField.fill(false);
        expect(boolField.state.value).toBe(false);
        expect(boolField.read()).toBe(false);

        const next = { n: 2 };
        await objField.fill(next);
        expect(objField.read()).toBe(next);
        expect(objField.serialize!()).toEqual({ value: { n: 2 }, errors: null });
      });
    });

    it("readFields is always empty for a leaf field", async () => {
      const appScope = scope();
      const field = createField("a");
      await scoped(appScope, async () => {
        expect(field.readFields()).toEqual({});
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A.3 Error model (precedence, channels, aliases, isValid)
  // ---------------------------------------------------------------------------
  describe("error model", () => {
    it("computes error as outer ?? inner across the full precedence sequence", async () => {
      const appScope = scope();
      const field = createField("");

      await scoped(appScope, async () => {
        await field.setInnerErrors("Inner");
        expect(field.error.value).toBe("Inner");

        await field.setOuterErrors("Outer");
        expect(field.error.value).toBe("Outer");

        await field.clearOuterErrors();
        expect(field.error.value).toBe("Inner");

        await field.clearInnerErrors();
        expect(field.error.value).toBe(null);
      });
    });

    it("emits the combined error on errorsChanged across the whole sequence", async () => {
      const appScope = scope();
      const field = createField("");
      const errorsChanged = watchCalls(field.errorsChanged);

      // NOTE: read only the channel stores (innerError/outerError) between writes.
      // Reading the combined `error` computed here would poison a stale snapshot
      // into the following in-effect emit (see the dedicated stale-computed test).
      await scoped(appScope, async () => {
        await field.setInnerErrors("Inner");
        expect(field.innerError.value).toBe("Inner");

        await field.setOuterErrors("Outer");
        expect(field.outerError.value).toBe("Outer");

        await field.clearOuterErrors();
        expect(field.outerError.value).toBe(null);

        await field.clearInnerErrors();
        expect(field.innerError.value).toBe(null);

        expect(errorsChanged).toEqual(["Inner", "Outer", "Inner", null]);
      });
    });

    it("dispatches through setInnerError/setOuterError singular event-callables", async () => {
      const appScope = scope();
      const field = createField("");
      const errorsChanged = watchCalls(field.errorsChanged);

      await scoped(appScope, async () => {
        await field.setInnerError("InnerSingular");
        expect(field.innerError.value).toBe("InnerSingular");

        await field.setOuterError("OuterSingular");
        expect(field.outerError.value).toBe("OuterSingular");
        // Final combined read (after the emits) is safe and correct.
        expect(field.error.value).toBe("OuterSingular");

        expect(errorsChanged).toEqual(["InnerSingular", "OuterSingular"]);
      });
    });

    it("carries the previously cached combined error on errorsChanged when the computed was read before an in-effect write", async () => {
      const appScope = scope();
      const field = createField("");
      const errorsChanged = watchCalls(field.errorsChanged);

      await scoped(appScope, async () => {
        await field.setInnerErrors("Inner");
        // Read the `error` computed once -> caches "Inner".
        expect(field.error.value).toBe("Inner");
        // Now write the outer channel: the write is correct, but the emit inside
        // the effect reads a STALE snapshot of the cached computed.
        await field.setOuterErrors("Outer");

        // The stored state is correct once read again outside the effect...
        expect(field.outerError.value).toBe("Outer");
        expect(field.error.value).toBe("Outer");
        // ...but errorsChanged carried the stale combined error ("Inner" instead
        // of "Outer"). Pinned as actual (buggy) behavior.
        expect(errorsChanged).toEqual(["Inner", "Inner"]);
      });
    });

    it("writes the outer channel through changeError, leaving inner untouched", async () => {
      const appScope = scope();
      const field = createField("");

      await scoped(appScope, async () => {
        await field.setInnerErrors("Inner");
        await field.changeError("Server");
        expect(field.outerError.value).toBe("Server");
        expect(field.innerError.value).toBe("Inner");
        expect(field.error.value).toBe("Server");
      });
    });

    it("aliases errors/innerErrors/outerErrors are the identical stores", () => {
      const field = createField("");
      expect(field.errors).toBe(field.error);
      expect(field.innerErrors).toBe(field.innerError);
      expect(field.outerErrors).toBe(field.outerError);
    });

    it("errorsChanged always carries the combined error, not the channel written", async () => {
      const appScope = scope();
      const field = createField("");
      const errorsChanged = watchCalls(field.errorsChanged);

      await scoped(appScope, async () => {
        await field.setOuterErrors("Outer");
        // Writing inner while outer dominates still reports the combined (outer) error.
        await field.setInnerErrors("Inner");
        expect(errorsChanged).toEqual(["Outer", "Outer"]);
      });
    });

    it("treats an empty-string error as invalid (isValid is strictly error === null)", async () => {
      const appScope = scope();
      const field = createField("");

      await scoped(appScope, async () => {
        await field.setOuterErrors("");
        expect(field.error.value).toBe("");
        expect(field.isValid.value).toBe(false);

        await field.clearOuterErrors();
        expect(field.error.value).toBe(null);
        expect(field.isValid.value).toBe(true);
      });
    });

    it("treats an undefined inner error as invalid (error is undefined, not null)", async () => {
      const appScope = scope();
      const field = createField("");

      await scoped(appScope, async () => {
        await field.setInnerErrors(undefined as unknown as string);
        expect(field.innerError.value).toBe(undefined);
        expect(field.error.value).toBe(undefined);
        expect(field.isValid.value).toBe(false);
      });
    });

    it("outer empty-string dominates inner because ?? only falls through on nullish", async () => {
      const appScope = scope();
      const field = createField("");

      await scoped(appScope, async () => {
        await field.setInnerErrors("Inner");
        await field.setOuterErrors("");
        expect(field.error.value).toBe("");
      });
    });

    it("outer undefined falls through to inner (nullish coalescing)", async () => {
      const appScope = scope();
      const field = createField("");

      await scoped(appScope, async () => {
        await field.setInnerErrors("Inner");
        await field.setOuterErrors(undefined as unknown as string);
        expect(field.outerError.value).toBe(undefined);
        expect(field.error.value).toBe("Inner");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A.4 Focus / blur
  // ---------------------------------------------------------------------------
  describe("focus and blur", () => {
    it("toggles isFocused and emits focused/blurred without any strategy", async () => {
      const appScope = scope();
      const field = createField("");
      const focused = watchCalls(field.focused);
      const blurred = watchCalls(field.blurred);

      await scoped(appScope, async () => {
        await field.focus();
        expect(field.isFocused.value).toBe(true);
        expect(field.error.value).toBe(null); // no strategy => no validate

        await field.blur();
        expect(field.isFocused.value).toBe(false);

        expect(focused).toEqual([undefined]);
        expect(blurred).toEqual([undefined]);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A.5 Meta
  // ---------------------------------------------------------------------------
  describe("meta", () => {
    it("changeMeta REPLACES the whole meta object (no merge)", async () => {
      const appScope = scope();
      const field = createField<string, { a: number; b?: number }>("", {
        meta: { a: 1, b: 2 },
      });

      await scoped(appScope, async () => {
        await field.changeMeta({ a: 9 });
        expect(readStoreSnapshot(field.meta)).toEqual({ a: 9 });
        expect((readStoreSnapshot(field.meta) as { b?: number }).b).toBe(undefined);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A.6 Reset
  // ---------------------------------------------------------------------------
  describe("reset", () => {
    it("restores value, inner error, meta and focus, and the outer error to options.error", async () => {
      const appScope = scope();
      const field = createField("initial", {
        error: "Default outer",
        meta: { dirty: false },
      });
      const changed = watchCalls(field.changed);
      const errorsChanged = watchCalls(field.errorsChanged);

      await scoped(appScope, async () => {
        await field.fill("changed");
        await field.setInnerErrors("Inner");
        await field.setOuterErrors("Outer");
        await field.changeMeta({ dirty: true });
        await field.focus();

        await field.reset();

        expect(field.state.value).toBe("initial");
        expect(field.innerError.value).toBe(null);
        expect(field.outerError.value).toBe("Default outer");
        expect(field.error.value).toBe("Default outer");
        expect(readStoreSnapshot(field.meta)).toEqual({ dirty: false });
        expect(field.isFocused.value).toBe(false);

        expect(changed.at(-1)).toBe("initial");
        expect(errorsChanged.at(-1)).toBe("Default outer");
      });
    });

    it("reset restores outer to null when no options.error was given", async () => {
      const appScope = scope();
      const field = createField("x");

      await scoped(appScope, async () => {
        await field.setOuterErrors("Outer");
        await field.reset();
        expect(field.outerError.value).toBe(null);
        expect(field.error.value).toBe(null);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A.7 Validation
  // ---------------------------------------------------------------------------
  describe("validation", () => {
    it("runs validators in order and stops at the first that hasErrors", async () => {
      const appScope = scope();
      const calls: string[] = [];
      const field = createField("", {
        validate: [
          (v: string) => {
            calls.push("first");
            return v ? null : "Required";
          },
          () => {
            calls.push("second");
            return "Second";
          },
        ],
      });

      await scoped(appScope, async () => {
        await field.validate();
        expect(field.error.value).toBe("Required");
        expect(calls).toEqual(["first"]);
      });
    });

    it("skips null AND undefined results and continues (undefined does not stop)", async () => {
      const appScope = scope();
      const calls: string[] = [];
      const field = createField("", {
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

    it("treats an empty-string validator result as a stopping error", async () => {
      const appScope = scope();
      const calls: string[] = [];
      const field = createField("", {
        validate: [
          () => {
            calls.push("empty");
            return "";
          },
          () => {
            calls.push("after");
            return "After";
          },
        ],
      });

      await scoped(appScope, async () => {
        await field.validate();
        expect(field.error.value).toBe("");
        expect(field.isValid.value).toBe(false);
        expect(calls).toEqual(["empty"]);
      });
    });

    it("sets inner to null and emits validated when there are no validators", async () => {
      const appScope = scope();
      const field = createField("");
      const validated = watchCalls(field.validated);
      const failed = watchCalls(field.validationFailed);

      await scoped(appScope, async () => {
        await field.setInnerErrors("Stale");
        await field.validate();
        expect(field.innerError.value).toBe(null);
        expect(validated).toEqual([""]);
        expect(failed).toEqual([]);
      });
    });

    it("emits validated on success and validationFailed on failure", async () => {
      const appScope = scope();
      const field = createField("", {
        validate: (v: string) => (v ? null : "Required"),
      });
      const validated = watchCalls(field.validated);
      const failed = watchCalls(field.validationFailed);

      await scoped(appScope, async () => {
        await field.validate();
        await field.fill("ok");
        await field.validate();
        expect(failed).toEqual([""]);
        expect(validated).toEqual(["ok"]);
      });
    });

    it("tracks isValidationPending true while running and false (final) after", async () => {
      const appScope = scope();
      const pending = deferred<string | null>();
      const field = createField("value", { validate: () => pending.promise });
      const pendingCalls = watchCalls(field.isValidationPending);

      await scoped(appScope, async () => {
        const run = field.validate();
        await tick();
        expect(field.isValidationPending.value).toBe(true);
        pending.resolve(null);
        await run;
        expect(field.isValidationPending.value).toBe(false);
        expect(pendingCalls.at(-1)).toBe(false);
      });
    });

    it("passes (value, ctx) with an empty path and a live AbortSignal to function validators", async () => {
      const appScope = scope();
      let seenValue: unknown;
      let seenCtx: ValidationContext | undefined;
      const field = createField("payload", {
        validate: (value: string, ctx: ValidationContext) => {
          seenValue = value;
          seenCtx = ctx;
          return null;
        },
      });

      await scoped(appScope, async () => {
        await field.validate();
        expect(seenValue).toBe("payload");
        expect(seenCtx?.path).toEqual([]);
        expect(seenCtx?.signal).toBeInstanceOf(AbortSignal);
        expect(seenCtx?.signal.aborted).toBe(false);
        expect(typeof seenCtx?.read).toBe("function");
      });
    });

    it("runs an effect validator with its own linked abort signal, distinct from ctx.signal", async () => {
      const appScope = scope();
      let handlerSignal: AbortSignal | undefined;
      let ctxSignal: AbortSignal | undefined;
      let payloadValue: unknown;
      const fx = effect<ValidationPayload<string>, string | null>(
        (payload: ValidationPayload<string>, { signal }: { signal: AbortSignal }) => {
          handlerSignal = signal;
          ctxSignal = payload.ctx.signal;
          payloadValue = payload.value;
          return null;
        },
      );
      const field = createField("hello", { validate: fx });

      await scoped(appScope, async () => {
        await field.validate();
        expect(payloadValue).toBe("hello");
        expect(handlerSignal).toBeInstanceOf(AbortSignal);
        expect(ctxSignal).toBeInstanceOf(AbortSignal);
        // runValidationUnit calls the effect as `validator({value,ctx}, { signal:
        // ctx.signal })`. The kernel links the passed ctx.signal as a parent of the
        // effect call's own controller (aborting either aborts the run), so the
        // handler sees its own execution signal — a distinct object from ctx.signal.
        expect(handlerSignal).not.toBe(ctxSignal);
      });
    });

    it("resolves effect validator handlers from the current scope (handler override)", async () => {
      const fx = effect<ValidationPayload<string>, string | null>(() => "Default handler");
      const firstScope = scope();
      const secondScope = scope({ handlers: [[fx, () => null]] });
      const field = createField("", { validate: fx });

      await scoped(firstScope, async () => {
        await field.validate();
        expect(field.error.value).toBe("Default handler");
      });
      await scoped(secondScope, async () => {
        await field.validate();
        expect(field.error.value).toBe(null);
      });
    });

    it("cancel-previous: aborts the superseded run, swallows AbortError and discards its stale result", async () => {
      const appScope = scope();
      const slow = deferred<string | null>();
      const fast = deferred<string | null>();
      const aborted: string[] = [];
      const field = createField<string>("bad", {
        validate(value: string, ctx: ValidationContext) {
          if (value === "bad") {
            ctx.signal.addEventListener(
              "abort",
              () => {
                aborted.push(value);
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
        await field.fill("good");
        const second = field.validate();
        fast.resolve(null);
        await second;
        await first; // must not throw despite the AbortError of the first run

        expect(aborted).toEqual(["bad"]);
        expect(field.error.value).toBe(null);
        expect(field.isValidationPending.value).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A.8 Strategies
  // ---------------------------------------------------------------------------
  describe("strategies", () => {
    it("validates inline on the change strategy (error is set once fill resolves)", async () => {
      const appScope = scope();
      const field = createField("", {
        validate: (v: string) => (v ? null : "Required"),
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await field.fill("");
        expect(field.error.value).toBe("Required"); // no tick needed
        await field.fill("ok");
        expect(field.error.value).toBe(null);
      });
    });

    it("validates on the focus and blur strategies once the awaited event settles", async () => {
      const appScope = scope();
      const focusField = createField("", {
        validate: () => "Focus error",
        validationStrategies: ["focus"],
      });
      const blurField = createField("", {
        validate: () => "Blur error",
        validationStrategies: ["blur"],
      });

      await scoped(appScope, async () => {
        // Awaiting focus()/blur() propagates through the reaction's `await
        // validate()`, so the error is already set on return (no extra tick
        // needed); tick(2) is added only to prove it stays stable.
        await focusField.focus();
        expect(focusField.error.value).toBe("Focus error");
        await tick(2);
        expect(focusField.error.value).toBe("Focus error");

        await blurField.blur();
        expect(blurField.error.value).toBe("Blur error");
        await tick(2);
        expect(blurField.error.value).toBe("Blur error");
      });
    });

    it("no strategy => fill/focus/blur never validate", async () => {
      const appScope = scope();
      const field = createField("", { validate: () => "Never" });

      await scoped(appScope, async () => {
        await field.fill("x");
        await field.focus();
        await field.blur();
        await tick(2);
        expect(field.error.value).toBe(null);
      });
    });

    it("supports multiple strategies together (change + blur)", async () => {
      const appScope = scope();
      const field = createField("", {
        validate: (v: string) => (v ? null : "Required"),
        validationStrategies: ["change", "blur"],
      });

      await scoped(appScope, async () => {
        await field.fill("");
        expect(field.error.value).toBe("Required"); // change => inline

        await field.fill("ok");
        expect(field.error.value).toBe(null);

        await field.fill("");
        expect(field.error.value).toBe("Required");
        await field.blur();
        await tick(2);
        expect(field.error.value).toBe("Required"); // blur re-validates, still failing
      });
    });

    it("treats unsupported strategies submit/manual as no-ops", async () => {
      const appScope = scope();
      const field = createField("", {
        validate: () => "Never",
        validationStrategies: ["submit", "manual"],
      });

      await scoped(appScope, async () => {
        await field.fill("x");
        await field.focus();
        await field.blur();
        await tick(2);
        expect(field.error.value).toBe(null);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A.9 Dependency tracking
  // ---------------------------------------------------------------------------
  describe("dependency tracking", () => {
    it("ctx.read tracks a store and returns its scoped snapshot; revalidates on change", async () => {
      const appScope = scope();
      const limit = store(5);
      let seenSnapshot: unknown;
      const field = createField(10, {
        validate(value: number, ctx: ValidationContext) {
          seenSnapshot = ctx.read(limit);
          return value <= (seenSnapshot as number) ? null : "Too big";
        },
      });

      await scoped(appScope, async () => {
        await field.validate();
        expect(seenSnapshot).toBe(5);
        expect(field.error.value).toBe("Too big");

        limit.value = 20;
        await scoped(() => tick(100));
        expect(seenSnapshot).toBe(20);
        expect(field.error.value).toBe(null);
      });
    });

    it("resubscribes when the read branch switches (old dep stops, new dep starts triggering)", async () => {
      const appScope = scope();
      const usePrimary = store(true);
      const primary = store("taken");
      const secondary = store("blocked");
      const field = createField("taken", {
        validate(value: string, ctx: ValidationContext) {
          const forbidden = ctx.read(usePrimary) ? ctx.read(primary) : ctx.read(secondary);
          return value === forbidden ? "Forbidden" : null;
        },
      });

      await scoped(appScope, async () => {
        await field.validate();
        expect(field.error.value).toBe("Forbidden");

        // secondary is NOT read on this branch => changing it does nothing.
        secondary.value = "free";
        await scoped(() => tick(100));
        expect(field.error.value).toBe("Forbidden");

        primary.value = "free";
        await scoped(() => tick(100));
        expect(field.error.value).toBe(null);

        // Switch the branch: now secondary is read, primary is not.
        usePrimary.value = false;
        await scoped(() => tick(100));
        expect(field.error.value).toBe(null);

        // primary is no longer read => no revalidation.
        primary.value = "taken";
        await scoped(() => tick(100));
        expect(field.error.value).toBe(null);

        // secondary now drives it.
        secondary.value = "taken";
        await scoped(() => tick(100));
        expect(field.error.value).toBe("Forbidden");
      });
    });

    it("zero dependencies => no subscription (unrelated store changes never re-run the validator)", async () => {
      const appScope = scope();
      const unrelated = store(0);
      let runs = 0;
      const field = createField("x", {
        validate: () => {
          runs += 1;
          return null;
        },
      });

      await scoped(appScope, async () => {
        await field.validate();
        expect(runs).toBe(1);

        unrelated.value = 1;
        unrelated.value = 2;
        await scoped(() => tick(100));
        expect(runs).toBe(1); // never re-ran
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A.10 Scope
  // ---------------------------------------------------------------------------
  describe("scope", () => {
    it("isolates value, errors, meta and focus per scope on one instance", async () => {
      const firstScope = scope();
      const secondScope = scope();
      const field = createField<string, { tag: string }>("initial", {
        meta: { tag: "seed" },
      });

      await scoped(firstScope, async () => {
        await field.fill("first");
        await field.setOuterErrors("First error");
        await field.changeMeta({ tag: "one" });
        await field.focus();
      });
      await scoped(secondScope, async () => {
        await field.fill("second");
        await field.setOuterErrors("Second error");
        await field.changeMeta({ tag: "two" });
      });

      await scoped(firstScope, async () => {
        expect(field.state.value).toBe("first");
        expect(field.error.value).toBe("First error");
        expect(readStoreSnapshot(field.meta)).toEqual({ tag: "one" });
        expect(field.isFocused.value).toBe(true);
      });
      await scoped(secondScope, async () => {
        expect(field.state.value).toBe("second");
        expect(field.error.value).toBe("Second error");
        expect(readStoreSnapshot(field.meta)).toEqual({ tag: "two" });
        expect(field.isFocused.value).toBe(false);
      });
    });

    it("does not leak the active scope after a dependency-driven revalidation", async () => {
      const scopeA = scope();
      const dep = store(1);
      const field = createField(5, {
        validate: (value: number, ctx: ValidationContext) =>
          value > ctx.read(dep) ? null : "Too small",
      });

      await scoped(scopeA, async () => {
        await field.validate();
        expect(field.error.value).toBe(null);
        dep.value = 10;
        await scoped(() => tick(100));
        expect(field.error.value).toBe("Too small");
      });

      // The detached revalidation must not have leaked scopeA into the global slot.
      expect(getCurrentScope()).toBe(null);

      // A fresh, unrelated validation still binds to its own scope.
      const scopeB = scope();
      const other = createField("", { validate: (v: string) => (v ? null : "Required") });
      await scoped(scopeB, async () => {
        await other.validate();
        expect(other.error.value).toBe("Required");
      });
      expect(getCurrentScope()).toBe(null);
    });
  });

  // ---------------------------------------------------------------------------
  // Additional corner cases (adversarial coverage)
  // ---------------------------------------------------------------------------
  describe("additional corner cases", () => {
    it("serialize reflects the combined error channel (outer precedence), not just null", async () => {
      const appScope = scope();
      const field = createField("v", { error: "Seed" });

      await scoped(appScope, async () => {
        expect(field.serialize!()).toEqual({ value: "v", errors: "Seed" });
        await field.setInnerErrors("Inner"); // outer "Seed" still dominates
        expect(field.serialize!()).toEqual({ value: "v", errors: "Seed" });
        await field.clearOuterErrors(); // now inner surfaces
        expect(field.serialize!()).toEqual({ value: "v", errors: "Inner" });
      });
    });

    it("change() event (not just fill) triggers change-strategy validation inline", async () => {
      const appScope = scope();
      const field = createField("", {
        validate: (v: string) => (v ? null : "Required"),
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await field.change("");
        expect(field.error.value).toBe("Required"); // inline, no tick
        await field.change("ok");
        expect(field.error.value).toBe(null);
      });
    });

    it("clearInnerErrors resolves and emits the combined error after clearing", async () => {
      const appScope = scope();
      const field = createField("");
      const errorsChanged = watchCalls(field.errorsChanged);

      await scoped(appScope, async () => {
        await field.setInnerErrors("Inner");
        await field.clearInnerErrors();
        expect(field.innerError.value).toBe(null);
        expect(errorsChanged).toEqual(["Inner", null]);
      });
    });

    it("setInnerErrors re-emits errorsChanged even when the value is unchanged (non-idempotent event)", async () => {
      const appScope = scope();
      const field = createField("");
      const errorsChanged = watchCalls(field.errorsChanged);

      await scoped(appScope, async () => {
        await field.setInnerErrors("Inner");
        await field.setInnerErrors("Inner");
        expect(errorsChanged).toEqual(["Inner", "Inner"]);
      });
    });

    it("repeated focus/blur toggles emit focused/blurred on each transition", async () => {
      const appScope = scope();
      const field = createField("");
      const focused = watchCalls(field.focused);
      const blurred = watchCalls(field.blurred);

      await scoped(appScope, async () => {
        await field.focus();
        await field.blur();
        await field.focus();
        await field.blur();
        expect(field.isFocused.value).toBe(false);
        expect(focused).toEqual([undefined, undefined]);
        expect(blurred).toEqual([undefined, undefined]);
      });
    });

    it("reset emits changed and errorsChanged exactly once each and restores default meta", async () => {
      const appScope = scope();
      const field = createField("init");

      await scoped(appScope, async () => {
        await field.fill("x");
        await field.setInnerErrors("Inner");
        const changed = watchCalls(field.changed);
        const errorsChanged = watchCalls(field.errorsChanged);
        await field.reset();
        expect(changed).toEqual(["init"]);
        expect(errorsChanged).toEqual([null]);
        expect(readStoreSnapshot(field.meta)).toEqual({});
      });
    });

    it("change-strategy validation re-reads the latest value on each fill", async () => {
      const appScope = scope();
      const seen: number[] = [];
      const field = createField(0, {
        validate: (v: number) => {
          seen.push(v);
          return v > 5 ? "Too big" : null;
        },
        validationStrategies: ["change"],
      });

      await scoped(appScope, async () => {
        await field.fill(3);
        expect(field.error.value).toBe(null);
        await field.fill(9);
        expect(field.error.value).toBe("Too big");
        expect(seen).toEqual([3, 9]);
      });
    });
  });
});
