import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { scope, scoped } from "@virentia/core";
import { staticModel } from "@virentia/core/models";
import { ScopeProvider } from "@virentia/react";
import { createField, createWizardForm, step } from "@virentia/forms";
import { afterEach, expect, it } from "vitest";
import { useForm, useWizardForm } from "../lib";

afterEach(cleanup);

it("keeps useWizardForm navigation and its current form isolated between model instances", async () => {
  const Signup = staticModel({ setup() { return { wizard: createWizardForm({
    schema: { email: createField(""), name: createField("") },
    steps: [step("account", { pick: { email: true } }), step("profile", { pick: { name: true } })] as const,
  }) }; } });
  const app = scope(), [a, b] = scoped(app, () => Signup.create([{}, {}]));
  function View({ model, label }: { model: typeof a; label: string }) {
    const wizard = useWizardForm(model.wizard), current = useForm(wizard.currentForm);
    return <section>
      <output data-testid={label}>{wizard.currentId}:{JSON.stringify(current.values)}</output>
      <button onClick={() => void wizard.next()}>next {label}</button>
    </section>;
  }
  const view = render(<ScopeProvider scope={app}><View model={a} label="a" /><View model={b} label="b" /></ScopeProvider>);
  try {
    await act(async () => { await a.wizard.currentForm.value.fill({ values: { email: "a@example.com" } }); });
    expect(screen.getByTestId("a").textContent).toBe('account:{"email":"a@example.com"}');
    expect(screen.getByTestId("b").textContent).toBe('account:{"email":""}');
    await act(async () => { fireEvent.click(screen.getByText("next a")); });
    expect(screen.getByTestId("a").textContent).toBe('profile:{"name":""}');
    expect(screen.getByTestId("b").textContent).toBe('account:{"email":""}');
    view.unmount();
    await a.dispose();
    await b.wizard.currentForm.value.fill({ values: { email: "still live" } });
    expect(b.wizard.form.values.value).toEqual({ email: "still live", name: "" });
  } finally { view.unmount(); await a.dispose(); await b.dispose(); }
});
