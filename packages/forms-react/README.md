# @virentia/forms-react

React bindings for Virentia form models.

Keep field and form logic in `@virentia/forms`; use this package at the
rendering boundary. Stores become render values, and form methods become
callbacks bound to the provided Virentia scope.

## Links

- Documentation: [movpushmov.dev/virentia/forms/react](https://movpushmov.dev/virentia/forms/react)
- Forms package: [movpushmov.dev/virentia/forms](https://movpushmov.dev/virentia/forms/)

## Install

```sh
pnpm add @virentia/forms-react @virentia/forms @virentia/react @virentia/core react
```

## ScopeProvider

```tsx
import { scope } from "@virentia/core";
import { ScopeProvider } from "@virentia/react";
import { SignupForm } from "./SignupForm";

const appScope = scope();

export function App() {
  return (
    <ScopeProvider scope={appScope}>
      <SignupForm />
    </ScopeProvider>
  );
}
```

## useForm

```tsx
import { createField, createForm } from "@virentia/forms";
import { useForm } from "@virentia/forms-react";

const signupForm = createForm({
  schema: {
    email: createField(""),
  },
});

export function SignupForm() {
  const form = useForm(signupForm);
  const values = form.values as { email: string };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit();
      }}
    >
      <input
        value={values.email}
        onChange={(event) =>
          void form.fill({ values: { email: event.currentTarget.value } })
        }
      />
    </form>
  );
}
```

## useField

Use `useField` when a component should accept any field contract: primitive,
custom, shape, or array.

```tsx
import { type AnyField } from "@virentia/forms";
import { useField } from "@virentia/forms-react";

export function TextInput({ field }: { field: AnyField }) {
  const view = useField<string, string | null, string>(field);

  return (
    <input
      value={view.value}
      aria-invalid={!view.isValid}
      onChange={(event) => void view.fill(event.currentTarget.value)}
    />
  );
}
```

## Main API

`useField`, `useForm`, `useWizard`, `useWizardForm`.

## License

MIT © 2026 movpushmov
