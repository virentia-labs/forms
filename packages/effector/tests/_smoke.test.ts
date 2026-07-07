import { describe, expect, it } from "vitest";
import { effect, scope as virentiaScope, scoped, store } from "@virentia/core";
import { associate, fool } from "@virentia/effector";
import { allSettled, fork } from "effector";

describe("minimal fooled virentia effect from effector", () => {
  it("allSettled on a fooled virentia effect runs it in the associated vScope", async () => {
    const box = store(0);
    const setFx = effect<number, void>(async (n: number) => { box.value = n; });
    const fooled = fool(setFx);
    const vScope = virentiaScope();
    const eScope = fork();
    associate({ virentia: vScope, effector: eScope });

    await allSettled(fooled as any, { scope: eScope, params: 42 });

    // eslint-disable-next-line no-console
    console.log("[dbg] box in vScope:", scoped(vScope, () => box.value));
    expect(scoped(vScope, () => box.value)).toBe(42);
  });
});
