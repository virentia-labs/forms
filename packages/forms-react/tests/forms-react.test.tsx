import { afterEach, describe, expect, it, vi } from "vitest";
import { scope, scoped, store, type Scope } from "@virentia/core";
import { ScopeProvider } from "@virentia/react";
import {
  createArrayField,
  createField,
  createForm,
  createShapeField,
  createWizard,
  normalizeField,
  readStoreSnapshot,
  step,
  type AnyField,
} from "@virentia/forms";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { useField, useForm, useWizard, useWizardForm } from "../lib";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Local harness (mirrors the scope idioms used across the repo test-suite)
// ---------------------------------------------------------------------------
async function tick(times = 1): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderWithScope(children: ReactNode, appScope: Scope = scope()) {
  return {
    appScope,
    ...render(<ScopeProvider scope={appScope}>{children}</ScopeProvider>),
  };
}

// Runs a virentia mutation and flushes React work inside act() so assertions
// observe a settled tree with no "not wrapped in act" warnings.
async function commit(fn: () => unknown | Promise<unknown>): Promise<void> {
  await act(async () => {
    await fn();
    await tick(3);
  });
}

function text(testid: string): string | null {
  return screen.getByTestId(testid).textContent;
}

describe("@virentia/forms-react", () => {
  // =========================================================================
  // useField
  // =========================================================================
  describe("useField", () => {
    it("exposes value, error channels, validity, pending flag and an undefined view for a plain field", () => {
      const field = createField("hello");

      function View() {
        const v = useField(field);
        return (
          <>
            <p data-testid="value">{v.value as string}</p>
            <p data-testid="errors">{String(v.errors)}</p>
            <p data-testid="inner">{String(v.innerErrors)}</p>
            <p data-testid="outer">{String(v.outerErrors)}</p>
            <p data-testid="valid">{String(v.isValid)}</p>
            <p data-testid="pending">{String(v.isValidationPending)}</p>
            <p data-testid="view">{String(v.view)}</p>
          </>
        );
      }

      renderWithScope(<View />);

      expect(text("value")).toBe("hello");
      expect(text("errors")).toBe("null");
      expect(text("inner")).toBe("null");
      expect(text("outer")).toBe("null");
      expect(text("valid")).toBe("true");
      expect(text("pending")).toBe("false");
      // A plain createField carries no `view`; it must surface as undefined.
      expect(text("view")).toBe("undefined");
    });

    it("re-renders when a scoped fill is committed outside React", async () => {
      const field = createField("a");
      const { appScope } = renderWithScope(<Value field={field} />);

      expect(text("value")).toBe("a");
      await commit(() => scoped(appScope, () => field.fill("b")));
      expect(text("value")).toBe("b");
    });

    it("re-renders when the field change event fires in scope", async () => {
      const field = createField("a");
      const { appScope } = renderWithScope(<Value field={field} />);

      await commit(() => scoped(appScope, () => field.change("c")));
      await waitFor(() => expect(text("value")).toBe("c"));
    });

    it("re-renders the validation error and invalid state after validate()", async () => {
      const field = createField("bad", {
        validate: (value: string) => (value === "bad" ? "nope" : null),
      });

      function View() {
        const v = useField(field);
        return (
          <>
            <button onClick={() => void v.validate()}>validate</button>
            <p data-testid="errors">{String(v.errors)}</p>
            <p data-testid="valid">{String(v.isValid)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      expect(text("errors")).toBe("null");

      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => {
        expect(text("errors")).toBe("nope");
        expect(text("valid")).toBe("false");
      });
    });

    it("re-renders the combined error as the inner and outer channels are set then cleared", async () => {
      const field = createField("x");

      function View() {
        const v = useField(field);
        return (
          <>
            <button data-testid="inner" onClick={() => void v.setInnerErrors("inner-err")}>
              inner
            </button>
            <button data-testid="outer" onClick={() => void v.setOuterErrors("outer-err")}>
              outer
            </button>
            <button data-testid="clearOuter" onClick={() => void v.clearOuterErrors()}>
              clearOuter
            </button>
            <button data-testid="clearInner" onClick={() => void v.clearInnerErrors()}>
              clearInner
            </button>
            <p data-testid="errors">{String(v.errors)}</p>
            <p data-testid="innerErrors">{String(v.innerErrors)}</p>
            <p data-testid="outerErrors">{String(v.outerErrors)}</p>
          </>
        );
      }

      renderWithScope(<View />);

      fireEvent.click(screen.getByTestId("inner"));
      await waitFor(() => {
        expect(text("innerErrors")).toBe("inner-err");
        // error = outer ?? inner, so with no outer the inner surfaces.
        expect(text("errors")).toBe("inner-err");
      });

      fireEvent.click(screen.getByTestId("outer"));
      await waitFor(() => {
        expect(text("outerErrors")).toBe("outer-err");
        // outer takes priority over inner.
        expect(text("errors")).toBe("outer-err");
      });

      fireEvent.click(screen.getByTestId("clearOuter"));
      await waitFor(() => {
        expect(text("outerErrors")).toBe("null");
        expect(text("errors")).toBe("inner-err");
      });

      fireEvent.click(screen.getByTestId("clearInner"));
      await waitFor(() => {
        expect(text("innerErrors")).toBe("null");
        expect(text("errors")).toBe("null");
      });
    });

    it("restores the value and clears errors after reset", async () => {
      const field = createField("seed");

      function View() {
        const v = useField(field);
        return (
          <>
            <button data-testid="mutate" onClick={() => void v.fill("changed")}>
              mutate
            </button>
            <button data-testid="err" onClick={() => void v.setOuterErrors("boom")}>
              err
            </button>
            <button data-testid="reset" onClick={() => void v.reset()}>
              reset
            </button>
            <p data-testid="value">{v.value as string}</p>
            <p data-testid="errors">{String(v.errors)}</p>
          </>
        );
      }

      renderWithScope(<View />);

      fireEvent.click(screen.getByTestId("mutate"));
      fireEvent.click(screen.getByTestId("err"));
      await waitFor(() => {
        expect(text("value")).toBe("changed");
        expect(text("errors")).toBe("boom");
      });

      fireEvent.click(screen.getByTestId("reset"));
      await waitFor(() => {
        expect(text("value")).toBe("seed");
        expect(text("errors")).toBe("null");
      });
    });

    it("toggles isValidationPending while an async validator is in flight", async () => {
      const gate = deferred<void>();
      const field = createField("v", {
        validate: async () => {
          await gate.promise;
          return null;
        },
      });

      function View() {
        const v = useField(field);
        return (
          <>
            <button onClick={() => void v.validate()}>validate</button>
            <p data-testid="pending">{String(v.isValidationPending)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      expect(text("pending")).toBe("false");

      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(text("pending")).toBe("true"));

      await act(async () => {
        gate.resolve();
        await tick(5);
      });
      await waitFor(() => expect(text("pending")).toBe("false"));
    });

    it("runs the returned methods inside the provider scope", async () => {
      const field = createField("a");
      const otherScope = scope();

      function View() {
        const v = useField(field);
        return (
          <>
            <button onClick={() => void v.fill("Z")}>fill</button>
            <p data-testid="value">{v.value as string}</p>
          </>
        );
      }

      const { appScope } = renderWithScope(<View />);

      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(text("value")).toBe("Z"));

      // The write landed in the provider scope only — a sibling scope is untouched.
      expect(scoped(appScope, () => readStoreSnapshot(field.state))).toBe("Z");
      expect(scoped(otherScope, () => readStoreSnapshot(field.state))).toBe("a");
    });

    it("surfaces the view of a custom field contract", () => {
      const custom = {
        kind: "custom",
        state: store("val"),
        view: { hint: "H" },
        fill: async () => {},
        reset: async () => {},
      } satisfies AnyField;

      function View() {
        const v = useField(custom);
        return (
          <>
            <p data-testid="value">{String(v.value)}</p>
            <p data-testid="view">{JSON.stringify(v.view)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      expect(text("value")).toBe("val");
      expect(text("view")).toBe(JSON.stringify({ hint: "H" }));
    });

    it("exposes the normalized field instance", () => {
      const field = createField("hello");
      let captured: unknown;

      function View() {
        const v = useField(field);
        captured = v.field;
        return null;
      }

      renderWithScope(<View />);
      // The hook surfaces the WeakMap-cached NormalizedField, so it is the same
      // instance an external normalizeField(field) resolves to.
      expect(captured).toBe(normalizeField(field));
    });

    it("renders a leaf field's scalar value and flat string error", async () => {
      const field = createField("leaf");

      function View() {
        const v = useField(field);
        return (
          <>
            <button onClick={() => void v.setOuterErrors("e")}>err</button>
            <p data-testid="value">{v.value as string}</p>
            <p data-testid="errors">{String(v.errors)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      expect(text("value")).toBe("leaf");
      expect(text("errors")).toBe("null");

      // Leaf error is a plain scalar string, not a nested structure.
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(text("errors")).toBe("e"));
    });

    it("renders a shape field's object value and per-key errors", async () => {
      const shape = createShapeField({ a: createField("x"), b: createField("y") });

      function View() {
        const v = useField(shape);
        return (
          <>
            <button onClick={() => void v.fill({ a: "z" })}>fill</button>
            <p data-testid="value">{JSON.stringify(v.value)}</p>
            <p data-testid="errors">{JSON.stringify(v.errors)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      expect(text("value")).toBe(JSON.stringify({ a: "x", b: "y" }));
      // Shape errors are keyed per child, unlike the leaf's flat string.
      expect(text("errors")).toBe(JSON.stringify({ a: null, b: null }));

      fireEvent.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(text("value")).toBe(JSON.stringify({ a: "z", b: "y" })),
      );
    });

    it("renders an array field's per-item errors and grows the list on fill", async () => {
      const arr = createArrayField<string>(["a", "b"]);

      function View() {
        const v = useField(arr);
        const items = v.value as readonly string[];
        return (
          <>
            <button onClick={() => void v.fill(["a", "b", "c"])}>fill</button>
            <p data-testid="len">{items.length}</p>
            <p data-testid="errors">{JSON.stringify(v.errors)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      expect(text("len")).toBe("2");
      // Array errors are per-item (aggregated from the child fields), not a flat scalar.
      expect(text("errors")).toBe(JSON.stringify([null, null]));

      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(text("len")).toBe("3"));
    });
  });

  // =========================================================================
  // useForm
  // =========================================================================
  describe("useForm", () => {
    function makeForm() {
      return createForm({
        schema: {
          name: createField("", {
            validate: (value: string) => (value.length > 3 ? "Too long" : null),
          }),
          age: createField(0),
        },
        validationStrategies: ["change"],
      });
    }

    it("exposes values, error channels, snapshot and the changed, valid and pending flags", () => {
      const form = makeForm();

      function View() {
        const v = useForm(form);
        return (
          <>
            <p data-testid="values">{JSON.stringify(v.values)}</p>
            <p data-testid="errors">{JSON.stringify(v.errors)}</p>
            <p data-testid="inner">{JSON.stringify(v.innerErrors)}</p>
            <p data-testid="outer">{JSON.stringify(v.outerErrors)}</p>
            <p data-testid="snapshot">{JSON.stringify(v.snapshot)}</p>
            <p data-testid="changed">{String(v.isChanged)}</p>
            <p data-testid="valid">{String(v.isValid)}</p>
            <p data-testid="pending">{String(v.isValidationPending)}</p>
          </>
        );
      }

      renderWithScope(<View />);

      expect(text("values")).toBe(JSON.stringify({ name: "", age: 0 }));
      expect(text("errors")).toBe(JSON.stringify({ name: null, age: null }));
      expect(text("inner")).toBe(JSON.stringify({ name: null, age: null }));
      expect(text("outer")).toBe(JSON.stringify({ name: null, age: null }));
      expect(text("snapshot")).toBe(JSON.stringify({ name: "", age: 0 }));
      expect(text("changed")).toBe("false");
      expect(text("valid")).toBe("true");
      expect(text("pending")).toBe("false");
    });

    it("re-renders values, errors, isChanged and isValid after a change-strategy fill", async () => {
      const form = makeForm();

      function View() {
        const v = useForm(form);
        return (
          <>
            <button onClick={() => void v.fill({ values: { name: "abcdef" } })}>fill</button>
            <p data-testid="values">{JSON.stringify(v.values)}</p>
            <p data-testid="errors">{JSON.stringify(v.errors)}</p>
            <p data-testid="changed">{String(v.isChanged)}</p>
            <p data-testid="valid">{String(v.isValid)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      fireEvent.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(text("values")).toBe(JSON.stringify({ name: "abcdef", age: 0 }));
        expect(text("errors")).toBe(JSON.stringify({ name: "Too long", age: null }));
        expect(text("changed")).toBe("true");
        expect(text("valid")).toBe("false");
      });
    });

    it("restores values, clears errors and resets isChanged after reset", async () => {
      const form = makeForm();

      function View() {
        const v = useForm(form);
        return (
          <>
            <button data-testid="fill" onClick={() => void v.fill({ values: { name: "abcdef" } })}>
              fill
            </button>
            <button data-testid="reset" onClick={() => void v.reset()}>
              reset
            </button>
            <p data-testid="values">{JSON.stringify(v.values)}</p>
            <p data-testid="errors">{JSON.stringify(v.errors)}</p>
            <p data-testid="changed">{String(v.isChanged)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      fireEvent.click(screen.getByTestId("fill"));
      await waitFor(() => expect(text("changed")).toBe("true"));

      fireEvent.click(screen.getByTestId("reset"));
      await waitFor(() => {
        expect(text("values")).toBe(JSON.stringify({ name: "", age: 0 }));
        expect(text("errors")).toBe(JSON.stringify({ name: null, age: null }));
        expect(text("changed")).toBe("false");
      });
    });

    it("surfaces errors on validate() without a preceding change", async () => {
      const form = createForm({
        schema: {
          name: createField("abcdef", {
            validate: (value: string) => (value.length > 3 ? "Too long" : null),
          }),
        },
      });

      function View() {
        const v = useForm(form);
        return (
          <>
            <button onClick={() => void v.validate()}>validate</button>
            <p data-testid="errors">{JSON.stringify(v.errors)}</p>
            <p data-testid="valid">{String(v.isValid)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      expect(text("errors")).toBe(JSON.stringify({ name: null }));

      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => {
        expect(text("errors")).toBe(JSON.stringify({ name: "Too long" }));
        expect(text("valid")).toBe("false");
      });
    });

    it("runs validation before submit()", async () => {
      const form = createForm({
        schema: {
          name: createField("abcdef", {
            validate: (value: string) => (value.length > 3 ? "Too long" : null),
          }),
        },
      });

      function View() {
        const v = useForm(form);
        return (
          <>
            <button onClick={() => void v.submit()}>submit</button>
            <p data-testid="errors">{JSON.stringify(v.errors)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(text("errors")).toBe(JSON.stringify({ name: "Too long" })),
      );
    });

    it("clears externally supplied outer errors on clearOuterErrors", async () => {
      const form = createForm({ schema: { name: createField("") } });

      function View() {
        const v = useForm(form);
        return (
          <>
            <button data-testid="set" onClick={() => void v.fill({ errors: { name: "srv" } })}>
              set
            </button>
            <button data-testid="clear" onClick={() => void v.clearOuterErrors()}>
              clear
            </button>
            <p data-testid="errors">{JSON.stringify(v.errors)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      fireEvent.click(screen.getByTestId("set"));
      await waitFor(() => expect(text("errors")).toBe(JSON.stringify({ name: "srv" })));

      fireEvent.click(screen.getByTestId("clear"));
      await waitFor(() => expect(text("errors")).toBe(JSON.stringify({ name: null })));
    });

    it("clears validation errors on clearInnerErrors", async () => {
      const form = createForm({
        schema: {
          name: createField("abcdef", {
            validate: (value: string) => (value.length > 3 ? "Too long" : null),
          }),
        },
      });

      function View() {
        const v = useForm(form);
        return (
          <>
            <button data-testid="validate" onClick={() => void v.validate()}>
              validate
            </button>
            <button data-testid="clear" onClick={() => void v.clearInnerErrors()}>
              clear
            </button>
            <p data-testid="inner">{JSON.stringify(v.innerErrors)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      fireEvent.click(screen.getByTestId("validate"));
      await waitFor(() => expect(text("inner")).toBe(JSON.stringify({ name: "Too long" })));

      fireEvent.click(screen.getByTestId("clear"));
      await waitFor(() => expect(text("inner")).toBe(JSON.stringify({ name: null })));
    });

    it("rebases the snapshot and clears isChanged on forceUpdateSnapshot", async () => {
      const form = createForm({ schema: { name: createField("") } });

      function View() {
        const v = useForm(form);
        return (
          <>
            <button data-testid="fill" onClick={() => void v.fill({ values: { name: "x" } })}>
              fill
            </button>
            <button data-testid="rebase" onClick={() => void v.forceUpdateSnapshot()}>
              rebase
            </button>
            <p data-testid="snapshot">{JSON.stringify(v.snapshot)}</p>
            <p data-testid="changed">{String(v.isChanged)}</p>
          </>
        );
      }

      renderWithScope(<View />);
      fireEvent.click(screen.getByTestId("fill"));
      await waitFor(() => {
        expect(text("changed")).toBe("true");
        expect(text("snapshot")).toBe(JSON.stringify({ name: "" }));
      });

      fireEvent.click(screen.getByTestId("rebase"));
      await waitFor(() => {
        expect(text("snapshot")).toBe(JSON.stringify({ name: "x" }));
        expect(text("changed")).toBe("false");
      });
    });

    it("passes fields through by identity", () => {
      const form = makeForm();
      let captured: unknown;

      function View() {
        const v = useForm(form);
        captured = v.fields;
        return null;
      }

      renderWithScope(<View />);
      expect(captured).toBe(form.fields);
    });

    it("passes the form model through by identity", () => {
      const form = makeForm();
      let captured: unknown;

      function View() {
        const v = useForm(form);
        captured = v.form;
        return null;
      }

      renderWithScope(<View />);
      expect(captured).toBe(form);
    });

    it("runs form methods inside the provider scope", async () => {
      const form = createForm({ schema: { name: createField("") } });
      const otherScope = scope();

      function View() {
        const v = useForm(form);
        return (
          <>
            <button onClick={() => void v.fill({ values: { name: "hi" } })}>fill</button>
            <p data-testid="values">{JSON.stringify(v.values)}</p>
          </>
        );
      }

      const { appScope } = renderWithScope(<View />);
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(text("values")).toBe(JSON.stringify({ name: "hi" })));

      expect(scoped(appScope, () => readStoreSnapshot(form.values))).toEqual({ name: "hi" });
      expect(scoped(otherScope, () => readStoreSnapshot(form.values))).toEqual({ name: "" });
    });

    it("re-renders the item count as array items are added then removed through fill", async () => {
      const form = createForm({
        schema: {
          tags: createArrayField<string>([]),
        },
      });

      function ArrayView() {
        const view = useForm(form);
        const tags = (view.values as { tags: readonly string[] }).tags;

        return (
          <>
            <button
              data-testid="add"
              onClick={() =>
                void view.fill({ values: { tags: [...tags, `tag-${tags.length}`] } })
              }
            >
              add
            </button>
            <button
              data-testid="remove"
              onClick={() => void view.fill({ values: { tags: tags.slice(1) } })}
            >
              remove
            </button>
            {tags.map((item, index) => (
              <span data-index={index} key={item}>
                {item}
              </span>
            ))}
          </>
        );
      }

      renderWithScope(<ArrayView />);

      fireEvent.click(screen.getByTestId("add"));
      fireEvent.click(screen.getByTestId("add"));

      await waitFor(() => {
        expect(document.querySelectorAll("span[data-index]").length).toBe(2);
      });

      fireEvent.click(screen.getByTestId("remove"));
      await waitFor(() => {
        expect(document.querySelectorAll("span[data-index]").length).toBe(1);
      });
    });
  });

  // =========================================================================
  // useWizard
  // =========================================================================
  describe("useWizard", () => {
    function makeWizard() {
      const form = createForm({
        schema: {
          email: createField("", {
            validate: (value: string) => (value ? null : "Email required"),
          }),
          name: "",
        },
      });
      const wizard = createWizard({
        form,
        steps: [
          step("account", { form: form.pick({ email: true }) }),
          step("profile", { form: form.pick({ name: true }) }),
        ],
      });
      return { form, wizard };
    }

    function WizardView({ wizard }: { wizard: ReturnType<typeof makeWizard>["wizard"] }) {
      const v = useWizard(wizard);
      return (
        <>
          <button data-testid="next" onClick={() => void v.next()}>next</button>
          <button data-testid="back" onClick={() => void v.back()}>back</button>
          <button data-testid="goto" onClick={() => void v.goTo("profile" as never)}>goto</button>
          <button data-testid="complete" onClick={() => void v.complete()}>complete</button>
          <button data-testid="reset" onClick={() => void v.reset()}>reset</button>
          <p data-testid="steps">{(v.steps as readonly unknown[]).length}</p>
          <p data-testid="visible">{(v.visibleSteps as readonly unknown[]).length}</p>
          <p data-testid="currentId">{String(v.currentId)}</p>
          <p data-testid="currentIndex">{v.currentIndex}</p>
          <p data-testid="currentStep">{(v.currentStep as { id: string }).id}</p>
          <p data-testid="currentForm">{String(Boolean(v.currentForm))}</p>
          <p data-testid="visited">{JSON.stringify(v.visitedIds)}</p>
          <p data-testid="completed">{JSON.stringify(v.completedIds)}</p>
          <p data-testid="canBack">{String(v.canGoBack)}</p>
          <p data-testid="canNext">{String(v.canGoNext)}</p>
        </>
      );
    }

    it("exposes the full wizard view at the first step", () => {
      const { wizard } = makeWizard();
      renderWithScope(<WizardView wizard={wizard} />);

      expect(text("steps")).toBe("2");
      expect(text("visible")).toBe("2");
      expect(text("currentId")).toBe("account");
      expect(text("currentIndex")).toBe("0");
      expect(text("currentStep")).toBe("account");
      expect(text("currentForm")).toBe("true");
      expect(text("visited")).toBe(JSON.stringify(["account"]));
      expect(text("completed")).toBe(JSON.stringify([]));
      expect(text("canBack")).toBe("false");
      expect(text("canNext")).toBe("true");
    });

    it("leaves the current step unchanged when next is invalid", async () => {
      const { wizard } = makeWizard();
      renderWithScope(<WizardView wizard={wizard} />);

      // Invalid email -> next is a no-op.
      fireEvent.click(screen.getByTestId("next"));
      await waitFor(() => expect(text("currentId")).toBe("account"));
      expect(text("completed")).toBe(JSON.stringify([]));
    });

    it("advances to the next step once the current step is valid", async () => {
      const { form, wizard } = makeWizard();
      const { appScope } = renderWithScope(<WizardView wizard={wizard} />);

      await commit(() => scoped(appScope, () => form.fill({ values: { email: "ada@x.com" } })));
      fireEvent.click(screen.getByTestId("next"));

      await waitFor(() => {
        expect(text("currentId")).toBe("profile");
        expect(text("currentIndex")).toBe("1");
        expect(text("completed")).toBe(JSON.stringify(["account"]));
        expect(text("visited")).toBe(JSON.stringify(["account", "profile"]));
        expect(text("canBack")).toBe("true");
        expect(text("canNext")).toBe("false");
      });
    });

    it("returns to the previous step on back", async () => {
      const { form, wizard } = makeWizard();
      const { appScope } = renderWithScope(<WizardView wizard={wizard} />);

      await commit(() => scoped(appScope, () => form.fill({ values: { email: "ada@x.com" } })));
      fireEvent.click(screen.getByTestId("next"));
      await waitFor(() => expect(text("currentId")).toBe("profile"));

      fireEvent.click(screen.getByTestId("back"));
      await waitFor(() => {
        expect(text("currentId")).toBe("account");
        expect(text("canBack")).toBe("false");
      });
    });

    it("jumps forward on goTo when intermediate steps validate", async () => {
      const { form, wizard } = makeWizard();
      const { appScope } = renderWithScope(<WizardView wizard={wizard} />);

      await commit(() => scoped(appScope, () => form.fill({ values: { email: "ada@x.com" } })));
      fireEvent.click(screen.getByTestId("goto"));

      await waitFor(() => {
        expect(text("currentId")).toBe("profile");
        expect(text("completed")).toBe(JSON.stringify(["account"]));
      });
    });

    it("marks every step completed on complete once all are valid", async () => {
      const { form, wizard } = makeWizard();
      const { appScope } = renderWithScope(<WizardView wizard={wizard} />);

      await commit(() => scoped(appScope, () => form.fill({ values: { email: "ada@x.com" } })));
      fireEvent.click(screen.getByTestId("complete"));

      await waitFor(() =>
        expect(text("completed")).toBe(JSON.stringify(["account", "profile"])),
      );
    });

    it("returns to the first step and clears completed on reset", async () => {
      const { form, wizard } = makeWizard();
      const { appScope } = renderWithScope(<WizardView wizard={wizard} />);

      await commit(() => scoped(appScope, () => form.fill({ values: { email: "ada@x.com" } })));
      fireEvent.click(screen.getByTestId("next"));
      await waitFor(() => expect(text("currentId")).toBe("profile"));

      fireEvent.click(screen.getByTestId("reset"));
      await waitFor(() => {
        expect(text("currentId")).toBe("account");
        expect(text("completed")).toBe(JSON.stringify([]));
        expect(text("visited")).toBe(JSON.stringify(["account"]));
      });
    });

    it("exposes useWizardForm as the same hook reference", () => {
      expect(useWizardForm).toBe(useWizard);
    });

    it("renders wizard state through useWizardForm", () => {
      const { wizard } = makeWizard();

      function View() {
        const v = useWizardForm(wizard);
        return <p data-testid="currentId">{String(v.currentId)}</p>;
      }

      renderWithScope(<View />);
      expect(text("currentId")).toBe("account");
    });

    it("passes the wizard model through by identity", () => {
      const { wizard } = makeWizard();
      let captured: unknown;

      function View() {
        const v = useWizard(wizard);
        captured = v.wizard;
        return null;
      }

      renderWithScope(<View />);
      expect(captured).toBe(wizard);
    });
  });

  // =========================================================================
  // Scope isolation (useStoreSnapshot subscribe filter: nextScope !== scope)
  // =========================================================================
  describe("scope isolation", () => {
    it("holds independent values under two ScopeProviders", async () => {
      const field = createField("init");
      const scopeA = scope();
      const scopeB = scope();

      function Labelled({ testid }: { testid: string }) {
        const v = useField(field);
        return <p data-testid={testid}>{v.value as string}</p>;
      }

      render(
        <>
          <ScopeProvider scope={scopeA}>
            <Labelled testid="a" />
          </ScopeProvider>
          <ScopeProvider scope={scopeB}>
            <Labelled testid="b" />
          </ScopeProvider>
        </>,
      );

      expect(text("a")).toBe("init");
      expect(text("b")).toBe("init");

      await commit(() => scoped(scopeA, () => field.fill("AAA")));
      await waitFor(() => expect(text("a")).toBe("AAA"));
      expect(text("b")).toBe("init");

      await commit(() => scoped(scopeB, () => field.fill("BBB")));
      await waitFor(() => expect(text("b")).toBe("BBB"));
      expect(text("a")).toBe("AAA");
    });

    it("does not re-render a component when a different scope mutates", async () => {
      const field = createField("init");
      const scopeA = scope();
      const scopeB = scope();
      const aCount = { n: 0 };
      const bCount = { n: 0 };

      function Counted({ testid, counter }: { testid: string; counter: { n: number } }) {
        counter.n += 1;
        const v = useField(field);
        return <p data-testid={testid}>{v.value as string}</p>;
      }

      render(
        <>
          <ScopeProvider scope={scopeA}>
            <Counted testid="a" counter={aCount} />
          </ScopeProvider>
          <ScopeProvider scope={scopeB}>
            <Counted testid="b" counter={bCount} />
          </ScopeProvider>
        </>,
      );

      expect(aCount.n).toBe(1);
      expect(bCount.n).toBe(1);

      await commit(() => scoped(scopeA, () => field.fill("AAA")));
      await waitFor(() => expect(text("a")).toBe("AAA"));
      // The B subscription's callback runs but the scope guard drops it: no re-render.
      expect(bCount.n).toBe(1);
      expect(aCount.n).toBeGreaterThanOrEqual(2);

      const aAfter = aCount.n;
      await commit(() => scoped(scopeB, () => field.fill("BBB")));
      await waitFor(() => expect(text("b")).toBe("BBB"));
      expect(aCount.n).toBe(aAfter);
      expect(bCount.n).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // subscription correctness
  // =========================================================================
  describe("subscription correctness", () => {
    it("matches the current scoped snapshot after rapid writes", async () => {
      const field = createField("0");
      const { appScope } = renderWithScope(<Value field={field} />);

      await commit(() => scoped(appScope, () => field.fill("1")));
      await commit(() => scoped(appScope, () => field.fill("2")));
      await commit(() => scoped(appScope, () => field.fill("3")));

      await waitFor(() => expect(text("value")).toBe("3"));
      expect(text("value")).toBe(scoped(appScope, () => readStoreSnapshot(field.state)));
    });

    it("does not update or warn after unmount", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const field = createField("x");
      const { appScope, unmount } = renderWithScope(<Value field={field} />);

      unmount();
      await commit(() => scoped(appScope, () => field.fill("y")));
      await tick(5);

      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("re-subscribes when the field prop identity changes", async () => {
      const field1 = createField("one");
      const field2 = createField("two");
      const appScope = scope();

      const { rerender } = render(
        <ScopeProvider scope={appScope}>
          <Value field={field1} />
        </ScopeProvider>,
      );
      expect(text("value")).toBe("one");

      rerender(
        <ScopeProvider scope={appScope}>
          <Value field={field2} />
        </ScopeProvider>,
      );
      await waitFor(() => expect(text("value")).toBe("two"));

      // Now subscribed to field2: mutating the old field must NOT update the DOM.
      await commit(() => scoped(appScope, () => field1.fill("one-x")));
      await tick(5);
      expect(text("value")).toBe("two");

      // Mutating the current field does update it.
      await commit(() => scoped(appScope, () => field2.fill("two-x")));
      await waitFor(() => expect(text("value")).toBe("two-x"));
    });

    it("re-subscribes when the form prop identity changes", async () => {
      const formA = createForm({ schema: { name: createField("A") } });
      const formB = createForm({ schema: { name: createField("B") } });
      const appScope = scope();

      function FormName({ form }: { form: typeof formA }) {
        const v = useForm(form);
        return <p data-testid="name">{(v.values as { name: string }).name}</p>;
      }

      const { rerender } = render(
        <ScopeProvider scope={appScope}>
          <FormName form={formA} />
        </ScopeProvider>,
      );
      expect(screen.getByTestId("name").textContent).toBe("A");

      rerender(
        <ScopeProvider scope={appScope}>
          <FormName form={formB} />
        </ScopeProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("B"));

      await commit(() => scoped(appScope, () => formA.fill({ values: { name: "A2" } })));
      await tick(5);
      expect(screen.getByTestId("name").textContent).toBe("B");
    });

    it("renders array and shape fields exactly once despite freshly built snapshots", async () => {
      // getSnapshot returns computed .value (stable reference) so the per-render
      // `snapshotRef.current = read()` cannot spin useSyncExternalStore.
      const arr = createArrayField<number>([1, 2, 3]);
      let arrRenders = 0;

      function ArrView() {
        arrRenders += 1;
        const v = useField(arr);
        return <p data-testid="len">{(v.value as readonly number[]).length}</p>;
      }

      renderWithScope(<ArrView />);
      await tick(10);
      expect(text("len")).toBe("3");
      expect(arrRenders).toBe(1);

      const shape = createShapeField({ a: createField("x") });
      let shapeRenders = 0;

      function ShapeView() {
        shapeRenders += 1;
        const v = useField(shape);
        return <p data-testid="a">{(v.value as { a: string }).a}</p>;
      }

      renderWithScope(<ShapeView />);
      await tick(10);
      expect(text("a")).toBe("x");
      expect(shapeRenders).toBe(1);
    });

    it("re-runs the values effect exactly once per field change", async () => {
      const form = createForm({ schema: { value: "" } });
      const onRender = vi.fn();

      function FormView() {
        const view = useForm(form);

        useEffect(() => {
          onRender(view.values);
        }, [view.values]);

        return (
          <input
            aria-label="value"
            value={(view.values as { value: string }).value}
            onChange={(event) => void view.fill({ values: { value: event.currentTarget.value } })}
          />
        );
      }

      renderWithScope(<FormView />);
      expect(onRender).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByLabelText("value"), { target: { value: "1" } });

      await waitFor(() => {
        expect(onRender).toHaveBeenCalledTimes(2);
      });
    });
  });
});

// Small shared leaf renderer used by several tests.
function Value({ field }: { field: ReturnType<typeof createField<string>> }) {
  const v = useField(field);
  return <p data-testid="value">{v.value as string}</p>;
}
