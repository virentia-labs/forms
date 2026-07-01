# @virentia/forms

Core form models for Virentia applications.

Use it to keep form behavior outside the UI layer. Fields store values and
errors, forms compose fields into payloads, validators run as functions or
effects, and wizards navigate between step forms.

## Links

- Documentation: [movpushmov.dev/virentia/forms](https://movpushmov.dev/virentia/forms/)
- API reference: [movpushmov.dev/virentia/api/forms](https://movpushmov.dev/virentia/api/forms)

## Install

```sh
pnpm add @virentia/forms @virentia/core
```

## Form Model

```ts
import { scope, scoped } from "@virentia/core";
import { createField, createForm } from "@virentia/forms";

export const signupForm = createForm({
  schema: {
    email: createField("", {
      validate(value) {
        return value.includes("@") ? null : "Use a valid email";
      },
    }),
    password: createField("", {
      validate(value) {
        return value.length >= 8 ? null : "Use at least 8 characters";
      },
    }),
    profile: {
      displayName: "",
    },
  },
});

const appScope = scope();

await scoped(appScope, async () => {
  await signupForm.fill({
    values: {
      email: "ada@example.com",
      password: "supersecret",
    },
  });

  await signupForm.submit();
});
```

## Main API

`createField`, `createForm`, `createArrayField`, `createShapeField`,
`createWizard`, `createWizardForm`, `step`, `fieldType`, `defineField`,
`normalizeField`, `readStoreSnapshot`.

## License

MIT © 2026 movpushmov
