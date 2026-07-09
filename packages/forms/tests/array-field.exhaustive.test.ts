import { describe, expect, it } from "vitest";
import { getCurrentScope, scope, scoped, store } from "@virentia/core";
import {
  createArrayField,
  createField,
  createShapeField,
  readStoreSnapshot,
  type ValidationContext,
} from "../lib";
import { deferred, tick, watchCalls } from "./_helpers";

// Exhaustive coverage for createArrayField (FRs B.1-B.7, flags F1/F4/F6/F8/F9/F10).
// Idioms: build instances OUTSIDE a scope, mutate INSIDE `scoped(appScope, ...)`.
describe("createArrayField - construction", () => {
  it("defaults to an empty collection", async () => {
    const appScope = scope();
    const tags = createArrayField<string>();

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(tags.state)).toEqual([]);
      expect(tags.length.value).toBe(0);
      expect(readStoreSnapshot(tags.items)).toEqual([]);
      expect(readStoreSnapshot(tags.itemFields)).toEqual({});
      expect(readStoreSnapshot(tags.errors)).toEqual([]);
      expect(tags.kind).toBe("array");
    });
  });

  it("reads initial values, keys item fields as \"0\",\"1\", and serializes null errors", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b", "c"]);

    await scoped(appScope, async () => {
      expect(tags.kind).toBe("array");
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "b", "c"]);
      expect(tags.length.value).toBe(3);
      expect(Object.keys(readStoreSnapshot(tags.itemFields))).toEqual([
        "0",
        "1",
        "2",
      ]);
      // read()/readFields()/serialize()
      expect(tags.read()).toEqual(["a", "b", "c"]);
      expect(Object.keys(tags.readFields?.() ?? {})).toEqual(["0", "1", "2"]);
      expect(tags.serialize?.()).toEqual({
        value: ["a", "b", "c"],
        errors: [null, null, null],
      });
    });
  });

  it("aliases fields to itemFields and both reflect the same instances", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    // `fields` is the very same computed store as `itemFields`.
    expect(tags.fields).toBe(tags.itemFields);

    await scoped(appScope, async () => {
      const items = readStoreSnapshot(tags.items);
      const fields = readStoreSnapshot(tags.itemFields);
      expect(fields["0"]).toBe(items[0]);
      expect(fields["1"]).toBe(items[1]);
      expect(tags.readFields?.()).toEqual(readStoreSnapshot(tags.itemFields));
    });
  });

  it("passes the 0-based index to a custom createItem at every creation site", async () => {
    const appScope = scope();
    const indices: number[] = [];
    const tags = createArrayField(["a", "b"], {
      createItem(value: string, index: number) {
        indices.push(index);
        return createField(`${value}@${index}`);
      },
    });

    // Construction fed 0,1.
    expect(indices).toEqual([0, 1]);

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(tags.state)).toEqual(["a@0", "b@1"]);
      indices.length = 0;
      await tags.push("c"); // index === current length (2)
      await tags.unshift("z"); // index 0
      await tags.insert(1, "m"); // clamped index 1
      await tags.replace(99, "tail"); // OOB -> insert append -> clamped index (length 5)
      expect(indices).toEqual([2, 0, 1, 5]);
    });
  });

  it("feeds the array index to createItem when fill EXTENDS the collection", async () => {
    const appScope = scope();
    const indices: number[] = [];
    const tags = createArrayField(["a"], {
      createItem(value: string, index: number) {
        indices.push(index);
        return createField(value);
      },
    });

    // construction created index 0
    expect(indices).toEqual([0]);

    await scoped(appScope, async () => {
      indices.length = 0;
      // reuse index 0, create new items at 1, 2, 3
      await tags.fill(["a", "b", "c", "d"]);
      expect(indices).toEqual([1, 2, 3]);
    });
  });

  it("FLAG F10: default createItem folds only the value (index is not used)", async () => {
    const appScope = scope();
    // If the default forwarded index into createField, pushing at index 2 would
    // change the stored value. It does not: values stay raw.
    const tags = createArrayField([10, 20]);

    await scoped(appScope, async () => {
      await tags.push(30);
      expect(readStoreSnapshot(tags.state)).toEqual([10, 20, 30]);
    });
  });
});

describe("createArrayField - structural mutations", () => {
  it("pushes, unshifts and inserts raw values and emits changed + errorsChanged", async () => {
    const appScope = scope();
    const tags = createArrayField(["b"]);
    const changed = watchCalls(tags.changed);
    const errorsChanged = watchCalls(tags.errorsChanged);

    await scoped(appScope, async () => {
      await tags.push("c");
      await tags.unshift("a");
      await tags.insert(1, "middle");

      expect(readStoreSnapshot(tags.state)).toEqual(["a", "middle", "b", "c"]);
      expect(tags.length.value).toBe(4);
      expect(changed).toEqual([
        ["b", "c"],
        ["a", "b", "c"],
        ["a", "middle", "b", "c"],
      ]);
      // Each structural op also mirrors an errorsChanged emission.
      expect(errorsChanged).toHaveLength(3);
    });
  });

  it("pushes/unshifts/inserts a field-instance (FieldContract branch) keeping identity", async () => {
    const appScope = scope();
    const tags = createArrayField(["a"]);
    const pushed = createField("pushed");
    const unshifted = createField("head");
    const inserted = createField("mid");

    await scoped(appScope, async () => {
      await tags.push(pushed);
      expect(readStoreSnapshot(tags.items)[1]).toBe(pushed);

      await tags.unshift(unshifted);
      expect(readStoreSnapshot(tags.items)[0]).toBe(unshifted);

      await tags.insert(1, inserted);
      expect(readStoreSnapshot(tags.items)[1]).toBe(inserted);

      expect(readStoreSnapshot(tags.state)).toEqual([
        "head",
        "mid",
        "a",
        "pushed",
      ]);
    });
  });

  it("FLAG F8: insert clamps the index to [0, length] (out-of-range becomes prepend/append)", async () => {
    const appScope = scope();
    const tags = createArrayField(["b"]);

    await scoped(appScope, async () => {
      await tags.insert(-10, "a");
      await tags.insert(100, "c");
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "b", "c"]);
    });
  });

  it("FLAG F9: remove is a no-op for out-of-range indexes (no changed/errorsChanged)", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);
    const changed = watchCalls(tags.changed);
    const errorsChanged = watchCalls(tags.errorsChanged);

    await scoped(appScope, async () => {
      await tags.remove(5);
      await tags.remove(-1);
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "b"]);
      expect(changed).toEqual([]);
      expect(errorsChanged).toEqual([]);

      await tags.remove(0);
      expect(readStoreSnapshot(tags.state)).toEqual(["b"]);
      expect(changed).toEqual([["b"]]);
    });
  });

  it("pop equals remove(length-1) and is a no-op on an empty collection", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);
    const changed = watchCalls(tags.changed);

    await scoped(appScope, async () => {
      await tags.pop();
      expect(readStoreSnapshot(tags.state)).toEqual(["a"]);
      await tags.pop();
      expect(readStoreSnapshot(tags.state)).toEqual([]);
      // pop on empty -> removeFx(-1) -> no-op, no extra changed
      await tags.pop();
      expect(readStoreSnapshot(tags.state)).toEqual([]);
      expect(changed).toEqual([["a"], []]);
    });
  });

  it("replace in-range value fills the EXISTING instance (identity kept)", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      const firstItem = readStoreSnapshot(tags.items)[0];
      await tags.replace(0, "changed");
      expect(readStoreSnapshot(tags.state)).toEqual(["changed", "b"]);
      expect(readStoreSnapshot(tags.items)[0]).toBe(firstItem);
    });
  });

  it("replace in-range field-instance swaps the instance", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);
    const replacement = createField("field");

    await scoped(appScope, async () => {
      const oldItem = readStoreSnapshot(tags.items)[1];
      await tags.replace(1, replacement);
      expect(readStoreSnapshot(tags.items)[1]).toBe(replacement);
      expect(readStoreSnapshot(tags.items)[1]).not.toBe(oldItem);
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "field"]);
    });
  });

  it("FLAG F8: replace out-of-range inserts (append for high, prepend for negative)", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      await tags.replace(99, "tail"); // clamp to length -> append
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "b", "tail"]);

      await tags.replace(-5, "head"); // clamp to 0 -> prepend
      expect(readStoreSnapshot(tags.state)).toEqual(["head", "a", "b", "tail"]);
    });
  });

  it("FLAG F8: move preserves instance identity, clamps `to`, and no-ops when `from` is OOB", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b", "c", "d"]);

    await scoped(appScope, async () => {
      const [ia, ib, ic, id] = readStoreSnapshot(tags.items);

      await tags.move(1, 3);
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "c", "d", "b"]);
      // state travels with the instance
      const afterMove = readStoreSnapshot(tags.items);
      expect(afterMove[3]).toBe(ib);
      expect(afterMove[0]).toBe(ia);
      expect(afterMove[1]).toBe(ic);
      expect(afterMove[2]).toBe(id);

      // `to` clamps into [0, length-1]
      await tags.move(0, 100);
      expect(readStoreSnapshot(tags.state)).toEqual(["c", "d", "b", "a"]);
      await tags.move(0, -100);
      expect(readStoreSnapshot(tags.state)).toEqual(["c", "d", "b", "a"]);

      // from OOB -> no-op
      const changed = watchCalls(tags.changed);
      await tags.move(99, 0);
      expect(readStoreSnapshot(tags.state)).toEqual(["c", "d", "b", "a"]);
      expect(changed).toEqual([]);
    });
  });

  it("swap preserves instance identity and no-ops when either index is OOB", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b", "c", "d"]);
    const changed = watchCalls(tags.changed);

    await scoped(appScope, async () => {
      const [ia, , ic] = readStoreSnapshot(tags.items);

      await tags.swap(0, 2);
      expect(readStoreSnapshot(tags.state)).toEqual(["c", "b", "a", "d"]);
      const swapped = readStoreSnapshot(tags.items);
      expect(swapped[0]).toBe(ic);
      expect(swapped[2]).toBe(ia);

      await tags.swap(0, 5);
      await tags.swap(-1, 0);
      expect(readStoreSnapshot(tags.state)).toEqual(["c", "b", "a", "d"]);
      // Only the valid swap emitted.
      expect(changed).toEqual([["c", "b", "a", "d"]]);
    });
  });

  it("clear empties the collection and resets own error boxes", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      await tags.setOuterErrors("Server list error");
      await tags.clear();

      expect(readStoreSnapshot(tags.state)).toEqual([]);
      expect(readStoreSnapshot(tags.errors)).toEqual([]);
      expect(tags.length.value).toBe(0);
      expect(readStoreSnapshot(tags.itemFields)).toEqual({});
    });
  });
});

describe("createArrayField - fill", () => {
  it("reuses instances, fills them, extends beyond and drops trailing, emitting changed once", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);
    const changed = watchCalls(tags.changed);

    await scoped(appScope, async () => {
      const [first, second] = readStoreSnapshot(tags.items);

      await tags.fill(["A", "B", "C"]);
      expect(readStoreSnapshot(tags.state)).toEqual(["A", "B", "C"]);
      expect(readStoreSnapshot(tags.items)[0]).toBe(first);
      expect(readStoreSnapshot(tags.items)[1]).toBe(second);
      // exactly one array-level changed for the whole fill
      expect(changed).toEqual([["A", "B", "C"]]);

      // shrink: trailing dropped, surviving instance reused
      await tags.fill(["only"]);
      expect(readStoreSnapshot(tags.state)).toEqual(["only"]);
      expect(readStoreSnapshot(tags.items)[0]).toBe(first);
      expect(tags.length.value).toBe(1);
    });
  });

  it("fills to an empty array", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      await tags.fill([]);
      expect(readStoreSnapshot(tags.state)).toEqual([]);
      expect(tags.length.value).toBe(0);
    });
  });

  it("\"change\" strategy runs validation as part of fill", async () => {
    const appScope = scope();
    const tags = createArrayField(["a"], {
      validate: (values: readonly string[]) =>
        values.length > 1 ? "Too many" : null,
      validationStrategies: ["change"],
    });

    await scoped(appScope, async () => {
      await tags.fill(["a", "b"]);
      expect(readStoreSnapshot(tags.errors)).toBe("Too many");
    });
  });
});

describe("createArrayField - reset", () => {
  it("FLAG F6: reset RECREATES item instances (identity lost) and restores initial values", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      const initialItems = readStoreSnapshot(tags.items);

      await tags.push("c");
      await tags.setOuterErrors("Server error");
      await tags.setInnerErrors("Inner error");
      await tags.reset();

      const afterReset = readStoreSnapshot(tags.items);
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "b"]);
      expect(readStoreSnapshot(tags.errors)).toEqual([null, null]);
      // brand-new instances (F6): none of the pre-reset instances survive
      expect(afterReset[0]).not.toBe(initialItems[0]);
      expect(afterReset[1]).not.toBe(initialItems[1]);
    });
  });
});

describe("createArrayField - error model", () => {
  it("distributes an inner array to items and mirrors errors precedence", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      await tags.setInnerErrors([null, "Bad tag"]);
      expect(readStoreSnapshot(tags.innerErrors)).toEqual([null, "Bad tag"]);
      expect(readStoreSnapshot(tags.errors)).toEqual([null, "Bad tag"]);

      // ownOuter (scalar) mirrors and takes top precedence.
      await tags.setOuterErrors("Server list error");
      expect(readStoreSnapshot(tags.outerErrors)).toBe("Server list error");
      expect(readStoreSnapshot(tags.errors)).toBe("Server list error");

      await tags.clearOuterErrors();
      expect(readStoreSnapshot(tags.errors)).toEqual([null, "Bad tag"]);

      await tags.clearInnerErrors();
      expect(readStoreSnapshot(tags.errors)).toEqual([null, null]);
    });
  });

  it("FLAG F4: a scalar inner error is stored on the own box and SHADOWS per-item errors", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      // give item 1 its own error first
      await tags.setInnerErrors([null, "Item error"]);
      expect(readStoreSnapshot(tags.errors)).toEqual([null, "Item error"]);

      // scalar inner shadows the per-item view entirely
      await tags.setInnerErrors("Whole-array error");
      expect(readStoreSnapshot(tags.innerErrors)).toBe("Whole-array error");
      expect(readStoreSnapshot(tags.errors)).toBe("Whole-array error");
    });
  });

  it("full precedence sequence: outer scalar > inner scalar > per-item", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      await tags.setInnerErrors([null, "per-item"]);
      expect(readStoreSnapshot(tags.errors)).toEqual([null, "per-item"]);

      await tags.setInnerErrors("inner-scalar");
      expect(readStoreSnapshot(tags.errors)).toBe("inner-scalar");

      await tags.setOuterErrors("outer-scalar");
      expect(readStoreSnapshot(tags.errors)).toBe("outer-scalar");

      await tags.clearOuterErrors();
      expect(readStoreSnapshot(tags.errors)).toBe("inner-scalar");

      await tags.clearInnerErrors();
      expect(readStoreSnapshot(tags.errors)).toEqual([null, null]);
    });
  });

  it("distributes an outer array to items", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      await tags.setOuterErrors(["outer0", null]);
      expect(readStoreSnapshot(tags.outerErrors)).toEqual(["outer0", null]);
      expect(readStoreSnapshot(tags.errors)).toEqual(["outer0", null]);
    });
  });

  it("an inner-error array SHORTER than items leaves trailing items untouched (no phantom undefined)", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b", "c"]);

    await scoped(appScope, async () => {
      // only one entry for three items: items 1 & 2 are not addressed and keep
      // their own (null) state instead of receiving a phantom `undefined` error.
      await tags.setInnerErrors(["only one"]);

      const errs = readStoreSnapshot(tags.errors) as readonly unknown[];
      expect(errs[0]).toBe("only one");
      expect(errs[1]).toBe(null);
      expect(errs[2]).toBe(null);
      expect(errs).toHaveLength(3);

      // The array is still invalid — but only because item 0 has a REAL error,
      // not because of a phantom undefined on the trailing items.
      expect(tags.isValid.value).toBe(false);

      const innerErrs = readStoreSnapshot(tags.innerErrors) as readonly unknown[];
      expect(innerErrs).toEqual(["only one", null, null]);
    });
  });

  it("a shorter inner-error array preserves each trailing item's own validation error", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b", "c"], {
      createItem: (value: string) =>
        createField(value, {
          validate: (next: string) => (next === "b" ? "no b allowed" : null),
        }),
    });

    await scoped(appScope, async () => {
      // item 1 ("b") fails its own validator first
      await tags.validate();
      expect(readStoreSnapshot(tags.errors)).toEqual([null, "no b allowed", null]);

      // a one-entry array addresses item 0 only; item 1 keeps its own error
      await tags.setInnerErrors(["from server"]);
      expect(readStoreSnapshot(tags.errors)).toEqual([
        "from server",
        "no b allowed",
        null,
      ]);
    });
  });

  it("supports nested shape item object errors", async () => {
    const appScope = scope();
    const people = createArrayField([{ name: "" }], {
      createItem(value: { name: string }) {
        return createShapeField({
          name: createField(value.name, {
            validate: (next: string) => (next ? null : "Name is required"),
          }),
        });
      },
    });

    await scoped(appScope, async () => {
      await people.validate();
      expect(readStoreSnapshot(people.errors)).toEqual([
        { name: "Name is required" },
      ]);

      await people.setOuterErrors([{ name: "Server name" }]);
      expect(readStoreSnapshot(people.errors)).toEqual([{ name: "Server name" }]);

      await people.fill([{ name: "Ada" }, { name: "Grace" }]);
      expect(readStoreSnapshot(people.state)).toEqual([
        { name: "Ada" },
        { name: "Grace" },
      ]);
    });
  });
});

describe("createArrayField - validation", () => {
  it("validates every item first (in order), then array validators on read()", async () => {
    const appScope = scope();
    const calls: string[] = [];
    const tags = createArrayField(["", "ok"], {
      createItem(value: string) {
        return createField(value, {
          validate(next: string) {
            calls.push(`item:${next}`);
            return next ? null : "Required";
          },
        });
      },
      validate(values: readonly string[]) {
        calls.push(`array:${values.length}`);
        return values.length >= 2 ? null : "At least two tags";
      },
    });

    await scoped(appScope, async () => {
      await tags.validate();
      expect(readStoreSnapshot(tags.errors)).toEqual(["Required", null]);
      expect(calls).toEqual(["item:", "item:ok", "array:2"]);
    });
  });

  it("an ARRAY result from the array validator distributes to items (own inner stays null)", async () => {
    const appScope = scope();
    const tags = createArrayField(["", "ok"], {
      createItem(value: string) {
        return createField(value, {
          validate: (next: string) => (next ? null : "item-required"),
        });
      },
      // returns an array -> distributed, overriding per-item validation
      validate: () => ["override-0", null] as const,
    });

    await scoped(appScope, async () => {
      await tags.validate();
      expect(readStoreSnapshot(tags.errors)).toEqual(["override-0", null]);
      // own inner box is null when an array was returned
      expect(readStoreSnapshot(tags.innerErrors)).toEqual(["override-0", null]);
    });
  });

  it("FLAG F4: a NON-array result is stored on the own inner box and shadows item errors", async () => {
    const appScope = scope();
    const tags = createArrayField(["", "ok"], {
      createItem(value: string) {
        return createField(value, {
          validate: (next: string) => (next ? null : "item-required"),
        });
      },
      validate: () => "list-level error",
    });

    await scoped(appScope, async () => {
      await tags.validate();
      expect(readStoreSnapshot(tags.errors)).toBe("list-level error");
    });
  });

  it("emits validated when clean and validationFailed when invalid", async () => {
    const appScope = scope();
    const okField = createArrayField(["x"], {
      validate: (values: readonly string[]) =>
        values.length > 0 ? null : "empty",
    });
    const badField = createArrayField(["x"], {
      validate: () => "always fails",
    });
    const okValidated = watchCalls(okField.validated);
    const okFailed = watchCalls(okField.validationFailed);
    const badValidated = watchCalls(badField.validated);
    const badFailed = watchCalls(badField.validationFailed);
    const errorsChanged = watchCalls(okField.errorsChanged);

    await scoped(appScope, async () => {
      await okField.validate();
      expect(okValidated).toEqual([["x"]]);
      expect(okFailed).toEqual([]);
      expect(errorsChanged).toHaveLength(1);

      await badField.validate();
      expect(badValidated).toEqual([]);
      expect(badFailed).toEqual([["x"]]);
    });
  });

  it("isValid and isValidationPending reflect own + item state", async () => {
    const appScope = scope();
    const pending = deferred<string | null>();
    const tags = createArrayField(["x"], {
      validate: () => pending.promise,
    });
    const pendingCalls = watchCalls(tags.isValidationPending);

    await scoped(appScope, async () => {
      expect(tags.isValid.value).toBe(true);
      const running = tags.validate();
      await tick();
      expect(tags.isValidationPending.value).toBe(true);
      pending.resolve("bad");
      await running;
      expect(tags.isValidationPending.value).toBe(false);
      expect(tags.isValid.value).toBe(false);
      expect(pendingCalls.at(-1)).toBe(false);
    });
  });

  it("isValidationPending is true while an ITEM validator is pending", async () => {
    const appScope = scope();
    const pending = deferred<string | null>();
    const tags = createArrayField(["x"], {
      createItem: (value: string) =>
        createField(value, { validate: () => pending.promise }),
    });

    await scoped(appScope, async () => {
      const running = tags.validate();
      await tick();
      expect(tags.isValidationPending.value).toBe(true);
      pending.resolve(null);
      await running;
      expect(tags.isValidationPending.value).toBe(false);
    });
  });

  it("aborts the previous async array validation run and discards its stale result", async () => {
    const appScope = scope();
    const slow = deferred<string | null>();
    const fast = deferred<string | null>();
    const reachedSlow = deferred();
    const aborted: string[] = [];
    const tags = createArrayField(["slow"], {
      validate(values: readonly string[], ctx: ValidationContext) {
        if (values[0] === "slow") {
          ctx.signal.addEventListener(
            "abort",
            () => {
              aborted.push("slow");
              slow.resolve("Stale error");
            },
            { once: true },
          );
          reachedSlow.resolve();
          return slow.promise;
        }
        return fast.promise;
      },
    });

    await scoped(appScope, async () => {
      const first = tags.validate();
      // Deterministically wait until the first run has entered the array
      // validator and registered its abort listener before superseding it.
      await reachedSlow.promise;
      await tags.fill(["fast"]);
      const second = tags.validate();

      fast.resolve(null);
      await second;
      await first;

      expect(aborted).toEqual(["slow"]);
      // stale "Stale error" was discarded; clean per-item view remains
      expect(readStoreSnapshot(tags.errors)).toEqual([null]);
    });
  });

  it("revalidates on array-level ctx.read dependency change while preserving item errors, without leaking scope", async () => {
    const appScope = scope();
    const minItems = store(2);
    const tags = createArrayField([""], {
      createItem: (value: string) =>
        createField(value, {
          validate: (next: string) => (next ? null : "Tag required"),
        }),
      validate: (values: readonly string[], ctx: ValidationContext) =>
        values.length >= ctx.read(minItems) ? null : "Too few tags",
    });

    await scoped(appScope, async () => {
      await tags.validate();
      expect(readStoreSnapshot(tags.errors)).toBe("Too few tags");

      minItems.value = 1;
      await scoped(() => tick(100));

      // dependency-driven revalidation flipped the array error and the per-item
      // view (item still empty -> "Tag required") is preserved
      expect(readStoreSnapshot(tags.errors)).toEqual(["Tag required"]);
      // the detached revalidation restored our ambient scope (no leak/clobber)
      expect(getCurrentScope()).toBe(appScope);
    });
  });
});

describe("createArrayField - wild corner cases", () => {
  it("setInnerErrors with an array LONGER than items ignores the extra entries", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      await tags.setInnerErrors([null, "x", "extra", "more"]);
      // The loop only visits the two live items; trailing entries are dropped.
      expect(readStoreSnapshot(tags.errors)).toEqual([null, "x"]);
      expect(tags.length.value).toBe(2);
      expect(tags.isValid.value).toBe(false);
    });
  });

  it("swap(i, i) re-emits changed but leaves order and identity intact", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b", "c"]);
    const changed = watchCalls(tags.changed);

    await scoped(appScope, async () => {
      const before = readStoreSnapshot(tags.items);
      await tags.swap(1, 1);
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "b", "c"]);
      expect(readStoreSnapshot(tags.items)[1]).toBe(before[1]);
      // both indexes are in-range, so it is NOT a no-op: one emission.
      expect(changed).toEqual([["a", "b", "c"]]);
    });
  });

  it("move(i, i) re-emits changed with unchanged order and preserved identity", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b", "c"]);
    const changed = watchCalls(tags.changed);

    await scoped(appScope, async () => {
      const before = readStoreSnapshot(tags.items);
      await tags.move(1, 1);
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "b", "c"]);
      expect(readStoreSnapshot(tags.items)[1]).toBe(before[1]);
      expect(changed).toEqual([["a", "b", "c"]]);
    });
  });

  it("remove drops a middle index and keeps surviving item identities", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b", "c"]);
    const changed = watchCalls(tags.changed);

    await scoped(appScope, async () => {
      const [ia, , ic] = readStoreSnapshot(tags.items);
      await tags.remove(1);
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "c"]);
      const after = readStoreSnapshot(tags.items);
      expect(after[0]).toBe(ia);
      expect(after[1]).toBe(ic);
      expect(changed).toEqual([["a", "c"]]);
    });
  });

  it("validates an empty collection against an array-level validator", async () => {
    const appScope = scope();
    const tags = createArrayField<string>([], {
      validate: (values: readonly string[]) =>
        values.length === 0 ? "empty" : null,
    });
    const failed = watchCalls(tags.validationFailed);

    await scoped(appScope, async () => {
      await tags.validate();
      // no items to visit; the array validator runs on read() === []
      expect(readStoreSnapshot(tags.errors)).toBe("empty");
      expect(tags.isValid.value).toBe(false);
      expect(failed).toEqual([[]]);
    });
  });

  it("pushing a field-instance emits changed and errorsChanged (field-contract branch)", async () => {
    const appScope = scope();
    const tags = createArrayField<string>([]);
    const changed = watchCalls(tags.changed);
    const errorsChanged = watchCalls(tags.errorsChanged);
    const pushed = createField("x");

    await scoped(appScope, async () => {
      await tags.push(pushed);
      expect(readStoreSnapshot(tags.items)[0]).toBe(pushed);
      expect(changed).toEqual([["x"]]);
      expect(errorsChanged).toHaveLength(1);
    });
  });

  it("serialize reflects the live outer error and current values", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      await tags.setOuterErrors("Server list error");
      expect(tags.serialize?.()).toEqual({
        value: ["a", "b"],
        errors: "Server list error",
      });
    });
  });
});

describe("createArrayField - scope isolation", () => {
  it("keeps mutations of one instance isolated per scope", async () => {
    const scopeA = scope();
    const scopeB = scope();
    const tags = createArrayField(["seed"]);

    await scoped(scopeA, async () => {
      await tags.push("a");
    });
    await scoped(scopeB, async () => {
      await tags.push("b");
    });

    await scoped(scopeA, async () => {
      expect(readStoreSnapshot(tags.state)).toEqual(["seed", "a"]);
    });
    await scoped(scopeB, async () => {
      expect(readStoreSnapshot(tags.state)).toEqual(["seed", "b"]);
    });
  });
});
