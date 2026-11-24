# @virentia/forms-zod

Zod validation adapter for Virentia Forms.

Use it when a form or field should be validated by a Zod schema while keeping
the form lifecycle in `@virentia/forms`.

## Links

- Documentation: [movpushmov.dev/virentia/forms/adapters](https://movpushmov.dev/virentia/forms/adapters)
- Forms package: [movpushmov.dev/virentia/forms](https://movpushmov.dev/virentia/forms/)

## Install

```sh
pnpm add @virentia/forms-zod @virentia/forms zod
```

## Form Validator

```ts
import { z } from "zod";
import { createForm } from "@virentia/forms";
import { zodValidator } from "@virentia/forms-zod";

const signupSchema = z.object({
  email: z.string().email(),
  age: z.number().min(18),
});

export const signupForm = createForm({
  schema: {
    email: "",
    age: 0,
  },
  validation: zodValidator(signupSchema),
});
```

Zod issue paths become nested form errors. For example, an issue at
`["email"]` is written to `form.errors.value.email`.

## Store-Aware Schemas

The schema can be a factory. Read Virentia stores through `ctx.read`; validation
will subscribe to those stores and rerun when they change.

```ts
import { store } from "@virentia/core";
import { z } from "zod";
import { createForm } from "@virentia/forms";
import { zodValidator } from "@virentia/forms-zod";

const minimumAge = store(21);

export const profileForm = createForm({
  schema: {
    age: 0,
  },
  validation: zodValidator((ctx) =>
    z.object({
      age: z.number().min(ctx.read(minimumAge)),
    }),
  ),
});
```

## Static models and owned fields

Declare validators with the model's shared graph. `fieldModel(initial, {
validate: zodFieldValidator(schema) })` keeps scalar validation with the field;
`createForm({ schema: () => ..., validation: zodValidator(...) })` keeps
cross-field rules with the form. Create independent fields through `children`;
use `refs` only when forms intentionally share one field's state and errors.

Schema factories should use `ctx.read(store)` for reactive dependencies. With a
form declared in `staticModel.setup`, each instance observes its own store
values and reruns its own validation. Pass an existing bound child store when
the dependency belongs to another model; the owning model keeps its lifetime.
No separate Zod adapter instance or `.static()` call is needed per field.

See the [field models guide](../../docs/field-models.md).

## Main API

`zodValidator`, `zodFormValidator`, `zodFieldValidator`.

## License

MIT © 2026 movpushmov
