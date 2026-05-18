import { describe, expect, it } from "vitest";
import { scope, scoped } from "@virentia/core";
import { createArrayField, createField, createShapeField, readStoreSnapshot } from "../lib";
import { watchCalls } from "./_helpers";

describe("createArrayField", () => {
  it("reads initial values, length, item fields and serialization", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      expect(readStoreSnapshot(tags.state)).toEqual(["a", "b"]);
      expect(tags.length.value).toBe(2);
      expect(Object.keys(readStoreSnapshot(tags.itemFields))).toEqual(["0", "1"]);
      expect(tags.serialize?.()).toEqual({ value: ["a", "b"], errors: [null, null] });
    });
  });

  it("pushes, unshifts and inserts items", async () => {
    const appScope = scope();
    const tags = createArrayField(["b"]);
    const changed = watchCalls(tags.changed);

    await scoped(appScope, async () => {
      await tags.push("c");
      await tags.unshift("a");
      await tags.insert(1, "middle");

      expect(readStoreSnapshot(tags.state)).toEqual(["a", "middle", "b", "c"]);
      expect(tags.length.value).toBe(4);
      expect(changed).toEqual([["b", "c"], ["a", "b", "c"], ["a", "middle", "b", "c"]]);
    });
  });

  it("clamps insert index to array bounds", async () => {
    const appScope = scope();
    const tags = createArrayField(["b"]);

    await scoped(appScope, async () => {
      await tags.insert(-10, "a");
      await tags.insert(100, "c");

      expect(readStoreSnapshot(tags.state)).toEqual(["a", "b", "c"]);
    });
  });

  it("moves and swaps items", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b", "c", "d"]);

    await scoped(appScope, async () => {
      await tags.swap(0, 2);
      expect(readStoreSnapshot(tags.state)).toEqual(["c", "b", "a", "d"]);

      await tags.move(1, 3);
      expect(readStoreSnapshot(tags.state)).toEqual(["c", "a", "d", "b"]);

      await tags.move(3, -10);
      expect(readStoreSnapshot(tags.state)).toEqual(["b", "c", "a", "d"]);
    });
  });

  it("ignores invalid remove, pop, move and swap indexes", async () => {
    const appScope = scope();
    const tags = createArrayField(["a"]);
    const changed = watchCalls(tags.changed);

    await scoped(appScope, async () => {
      await tags.remove(5);
      await tags.move(5, 0);
      await tags.swap(0, 5);
      expect(readStoreSnapshot(tags.state)).toEqual(["a"]);
      expect(changed).toEqual([]);

      await tags.pop();
      await tags.pop();
      expect(readStoreSnapshot(tags.state)).toEqual([]);
      expect(changed).toEqual([[]]);
    });
  });

  it("replaces existing item values, swaps field instances and inserts out of range", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);
    const replacement = createField("field");

    await scoped(appScope, async () => {
      const firstItem = readStoreSnapshot(tags.items)[0];

      await tags.replace(0, "changed");
      expect(readStoreSnapshot(tags.state)).toEqual(["changed", "b"]);
      expect(readStoreSnapshot(tags.items)[0]).toBe(firstItem);

      await tags.replace(1, replacement);
      expect(readStoreSnapshot(tags.items)[1]).toBe(replacement);
      expect(readStoreSnapshot(tags.state)).toEqual(["changed", "field"]);

      await tags.replace(99, "tail");
      expect(readStoreSnapshot(tags.state)).toEqual(["changed", "field", "tail"]);
    });
  });

  it("fills by reusing existing fields, extending and shrinking the collection", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      const [first, second] = readStoreSnapshot(tags.items);

      await tags.fill(["A", "B", "C"]);
      expect(readStoreSnapshot(tags.state)).toEqual(["A", "B", "C"]);
      expect(readStoreSnapshot(tags.items)[0]).toBe(first);
      expect(readStoreSnapshot(tags.items)[1]).toBe(second);

      await tags.fill(["only"]);
      expect(readStoreSnapshot(tags.state)).toEqual(["only"]);
      expect(readStoreSnapshot(tags.items)[0]).toBe(first);
    });
  });

  it("resets values, item instances and errors", async () => {
    const appScope = scope();
    const tags = createArrayField(["a"]);

    await scoped(appScope, async () => {
      const firstInitialItem = readStoreSnapshot(tags.items)[0];

      await tags.push("b");
      await tags.setOuterErrors("Server error");
      await tags.reset();

      expect(readStoreSnapshot(tags.state)).toEqual(["a"]);
      expect(readStoreSnapshot(tags.errors)).toEqual([null]);
      expect(readStoreSnapshot(tags.items)[0]).not.toBe(firstInitialItem);
    });
  });

  it("distributes array errors to item fields and supports own array error", async () => {
    const appScope = scope();
    const tags = createArrayField(["a", "b"]);

    await scoped(appScope, async () => {
      await tags.setInnerErrors([null, "Bad tag"]);
      expect(readStoreSnapshot(tags.innerErrors)).toEqual([null, "Bad tag"]);
      expect(readStoreSnapshot(tags.errors)).toEqual([null, "Bad tag"]);

      await tags.setOuterErrors("Server list error");
      expect(readStoreSnapshot(tags.errors)).toBe("Server list error");

      await tags.clearOuterErrors();
      expect(readStoreSnapshot(tags.errors)).toEqual([null, "Bad tag"]);

      await tags.clearInnerErrors();
      expect(readStoreSnapshot(tags.errors)).toEqual([null, null]);
    });
  });

  it("validates item fields before array-level validators", async () => {
    const appScope = scope();
    const calls: string[] = [];
    const tags = createArrayField(["", "ok"], {
      createItem(value) {
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

  it("supports nested shape item fields", async () => {
    const appScope = scope();
    const people = createArrayField([{ name: "" }], {
      createItem(value) {
        return createShapeField({
          name: createField(value.name, {
            validate: (next: string) => (next ? null : "Name is required"),
          }),
        });
      },
    });

    await scoped(appScope, async () => {
      await people.validate();
      expect(readStoreSnapshot(people.errors)).toEqual([{ name: "Name is required" }]);

      await people.setOuterErrors([{ name: "Server name" }]);
      expect(readStoreSnapshot(people.errors)).toEqual([{ name: "Server name" }]);

      await people.fill([{ name: "Ada" }, { name: "Grace" }]);
      expect(readStoreSnapshot(people.state)).toEqual([{ name: "Ada" }, { name: "Grace" }]);
    });
  });

  it("clears values and own errors", async () => {
    const appScope = scope();
    const tags = createArrayField(["a"]);

    await scoped(appScope, async () => {
      await tags.setOuterErrors("Server list error");
      await tags.clear();

      expect(readStoreSnapshot(tags.state)).toEqual([]);
      expect(readStoreSnapshot(tags.errors)).toEqual([]);
      expect(tags.length.value).toBe(0);
    });
  });
});
