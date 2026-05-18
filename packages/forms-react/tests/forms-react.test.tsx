import { afterEach, describe, expect, it, vi } from "vitest";
import { scope, scoped } from "@virentia/core";
import { ScopeProvider } from "@virentia/react";
import {
  createArrayField,
  createField,
  createForm,
  createWizard,
  readStoreSnapshot,
  step,
} from "@virentia/forms";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { useField, useForm, useWizard } from "../lib";

afterEach(() => {
  cleanup();
});

function renderWithScope(children: ReactNode) {
  const appScope = scope();

  return {
    appScope,
    ...render(<ScopeProvider scope={appScope}>{children}</ScopeProvider>),
  };
}

describe("@virentia/forms-react", () => {
  it("renders a field value and updates it through scoped fill", async () => {
    const field = createField("a");

    function FieldView() {
      const view = useField(field);

      return (
        <>
          <input
            aria-label="value"
            value={view.value as string}
            onChange={(event) => void view.fill(event.currentTarget.value)}
          />
          <p data-testid="value">{view.value as string}</p>
        </>
      );
    }

    renderWithScope(<FieldView />);

    expect(screen.getByTestId("value").textContent).toBe("a");
    fireEvent.change(screen.getByLabelText("value"), { target: { value: "abcd" } });

    await waitFor(() => {
      expect(screen.getByTestId("value").textContent).toBe("abcd");
    });
  });

  it("renders field errors and updates them through scoped methods", async () => {
    const field = createField("");

    function FieldView() {
      const view = useField(field);

      return (
        <>
          <button onClick={() => void view.setOuterErrors("Server error")}>error</button>
          <p data-testid="error">{view.errors as string | null}</p>
        </>
      );
    }

    renderWithScope(<FieldView />);

    expect(screen.getByTestId("error").textContent).toBe("");
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("Server error");
    });
  });

  it("updates form values and validation errors", async () => {
    const form = createForm({
      schema: {
        name: createField("", {
          validate: (value: string) => (value.length > 3 ? "Too long" : null),
        }),
      },
      validationStrategies: ["change"],
    });

    function FormView() {
      const view = useForm(form);
      const field = useField(form.fields.name);

      return (
        <>
          <input
            aria-label="name"
            value={field.value as string}
            onChange={(event) => void field.fill(event.currentTarget.value)}
          />
          <p data-testid="value">{(view.values as { name: string }).name}</p>
          <p data-testid="error">{(view.errors as { name: string | null }).name}</p>
        </>
      );
    }

    renderWithScope(<FormView />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "abcdef" } });

    await waitFor(() => {
      expect(screen.getByTestId("value").textContent).toBe("abcdef");
      expect(screen.getByTestId("error").textContent).toBe("Too long");
    });
  });

  it("renders array field changes inside a form", async () => {
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

  it("keeps hook updates to one render after one field change", async () => {
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

  it("renders wizard state and scoped navigation methods", async () => {
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

    function WizardView() {
      const view = useWizard(wizard);

      return (
        <>
          <p data-testid="current">{view.currentId as string}</p>
          <button onClick={() => void view.next()}>next</button>
        </>
      );
    }

    const { appScope } = renderWithScope(<WizardView />);

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByTestId("current").textContent).toBe("account");
    });

    await scoped(appScope, () => form.fill({ values: { email: "ada@example.com" } }));
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByTestId("current").textContent).toBe("profile");
    });
    scoped(appScope, () => {
      expect(readStoreSnapshot(wizard.completedIds)).toEqual(["account"]);
    });
  });
});
