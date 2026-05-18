import { describe, expect, it } from "vitest";
import { scope, scoped, store } from "@virentia/core";
import { createField, readStoreSnapshot, type ValidationContext } from "../lib";
import { deferred, tick, watchCalls } from "./_helpers";

describe("createField", () => {
  it("changes value through fill and change event", async () => {
    const appScope = scope();
    const field = createField("Ada");
    const changed = watchCalls(field.changed);

    await scoped(appScope, async () => {
      await field.fill("Grace");
      expect(field.state.value).toBe("Grace");

      await field.change("Linus");
      expect(field.state.value).toBe("Linus");
      expect(changed).toEqual(["Grace", "Linus"]);
    });
  });

  it("keeps inner and outer errors separated with outer priority", async () => {
    const appScope = scope();
    const field = createField("");
    const errorsChanged = watchCalls(field.errorsChanged);

    await scoped(appScope, async () => {
      await field.setInnerErrors("Inner");
      expect(field.innerError.value).toBe("Inner");
      expect(field.outerError.value).toBe(null);
      expect(field.error.value).toBe("Inner");

      await field.setOuterErrors("Outer");
      expect(field.error.value).toBe("Outer");

      await field.clearOuterErrors();
      expect(field.error.value).toBe("Inner");

      await field.changeError("Server");
      expect(field.outerError.value).toBe("Server");
      expect(field.error.value).toBe("Server");

      await field.clearInnerErrors();
      expect(field.innerError.value).toBe(null);
      expect(field.error.value).toBe("Server");
      expect(errorsChanged.at(0)).toBe("Inner");
      expect(errorsChanged.at(-1)).toBe("Server");
    });
  });

  it("focuses, blurs and resets focus state", async () => {
    const appScope = scope();
    const field = createField("");
    const focused = watchCalls(field.focused);
    const blurred = watchCalls(field.blurred);

    await scoped(appScope, async () => {
      await field.focus();
      expect(field.isFocused.value).toBe(true);

      await field.blur();
      expect(field.isFocused.value).toBe(false);

      await field.focus();
      await field.reset();
      expect(field.isFocused.value).toBe(false);
      expect(focused).toEqual([undefined, undefined]);
      expect(blurred).toEqual([undefined]);
    });
  });

  it("resets value, errors and meta to defaults", async () => {
    const appScope = scope();
    const field = createField("initial", {
      error: "Default outer",
      meta: { dirtyByUser: false },
    });

    await scoped(appScope, async () => {
      await field.fill("changed");
      await field.setInnerErrors("Inner");
      await field.setOuterErrors("Outer");
      await field.changeMeta({ dirtyByUser: true });

      await field.reset();

      expect(field.state.value).toBe("initial");
      expect(field.innerError.value).toBe(null);
      expect(field.outerError.value).toBe("Default outer");
      expect(field.error.value).toBe("Default outer");
      expect(readStoreSnapshot(field.meta)).toEqual({ dirtyByUser: false });
    });
  });

  it("runs validators in order and stops at the first failing validator", async () => {
    const appScope = scope();
    const calls: string[] = [];
    const field = createField("", {
      validate: [
        (value: string) => {
          calls.push(`required:${value}`);
          return value ? null : "Required";
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
      expect(calls).toEqual(["required:"]);

      await field.fill("ok");
      await field.validate();
      expect(field.error.value).toBe("Second");
      expect(calls).toEqual(["required:", "required:ok", "second"]);
    });
  });

  it("emits validated or validationFailed after manual validation", async () => {
    const appScope = scope();
    const field = createField("", {
      validate: (value: string) => (value ? null : "Required"),
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

  it("supports change, focus and blur validation strategies", async () => {
    const appScope = scope();
    const changeField = createField("", {
      validate: (value: string) => (value ? null : "Required"),
      validationStrategies: ["change"],
    });
    const focusField = createField("", {
      validate: () => "Focus error",
      validationStrategies: ["focus"],
    });
    const blurField = createField("", {
      validate: () => "Blur error",
      validationStrategies: ["blur"],
    });

    await scoped(appScope, async () => {
      await changeField.fill("");
      expect(changeField.error.value).toBe("Required");

      await focusField.focus();
      await tick(2);
      expect(focusField.error.value).toBe("Focus error");

      await blurField.blur();
      await tick(2);
      expect(blurField.error.value).toBe("Blur error");
    });
  });

  it("ignores stale async validation results", async () => {
    const appScope = scope();
    const slow = deferred<string | null>();
    const fast = deferred<string | null>();
    const field = createField("bad", {
      validate: (value: string) => (value === "bad" ? slow.promise : fast.promise),
    });

    await scoped(appScope, async () => {
      const first = field.validate();
      await tick();

      await field.fill("good");
      const second = field.validate();
      fast.resolve(null);
      await second;

      expect(field.error.value).toBe(null);

      slow.resolve("Stale error");
      await first;
      expect(field.error.value).toBe(null);
      expect(field.isValidationPending.value).toBe(false);
    });
  });

  it("tracks validator store dependencies and resubscribes when branches change", async () => {
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

      secondary.value = "free";
      await tick(3);
      expect(field.error.value).toBe("Forbidden");

      primary.value = "free";
      await tick(3);
      expect(field.error.value).toBe(null);

      usePrimary.value = false;
      await tick(3);
      expect(field.error.value).toBe(null);

      primary.value = "taken";
      await tick(3);
      expect(field.error.value).toBe(null);

      secondary.value = "taken";
      await tick(3);
      expect(field.error.value).toBe("Forbidden");
    });
  });

  it("isolates values and errors by Virentia scope", async () => {
    const firstScope = scope();
    const secondScope = scope();
    const field = createField("initial");

    await scoped(firstScope, async () => {
      await field.fill("first");
      await field.setOuterErrors("First error");
    });
    await scoped(secondScope, async () => {
      await field.fill("second");
      await field.setOuterErrors("Second error");
    });

    await scoped(firstScope, async () => {
      expect(field.state.value).toBe("first");
      expect(field.error.value).toBe("First error");
    });
    await scoped(secondScope, async () => {
      expect(field.state.value).toBe("second");
      expect(field.error.value).toBe("Second error");
    });
  });
});
