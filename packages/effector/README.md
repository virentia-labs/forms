# @virentia/forms-effector

Bridge a [`@virentia/forms`](../forms) model into Effector units, so an existing
Effector application can read a form's state and drive its lifecycle without
rewriting the form. It is a **bridge** built on
[`@virentia/effector`](https://movpushmov.dev/virentia/effector/)'s `fool` — the
virentia form stays the source of truth — not a reimplementation of the form in
Effector.

Nested units (array-field items, shape fields, nested groups) are exposed through
a lens API shaped like [`@effector-kit/models`](https://github.com/movpushmov/effector-kit).

## Install

```sh
pnpm add @virentia/forms-effector @virentia/forms @virentia/effector effector @virentia/core
```

## Usage

```ts
import { createForm, createArrayField, createField } from "@virentia/forms";
import { formToEffector } from "@virentia/forms-effector";
import { associate } from "@virentia/effector";
import { scope as virentiaScope } from "@virentia/core";
import { fork, sample, createEvent, allSettled } from "effector";

const form = createForm({
  schema: {
    email: createField(""),
    phones: createArrayField<string>([""]),
  },
});

const model = formToEffector(form);

// Pair the scopes once per run (test / request / render), as usual for @virentia/effector.
const vScope = virentiaScope();
const eScope = fork();
associate({ virentia: vScope, effector: eScope });
```

### Top level

State is exposed as `$`-prefixed effector stores, lifecycle as effector events,
and every mutating method as an effector effect that runs the virentia method
inside the associated virentia scope:

```ts
model.$values;              // Store<{ email: string; phones: string[] }>
model.$errors;              // Store<...>
model.$isValid;             // Store<boolean>
model.$isValidationPending; // Store<boolean>

model.changed;              // Event<Values>
model.submitted;            // Event<Values>

model.submit;               // Effect<void, void>
model.validate;             // Effect<void, void>
model.fill;                 // Effect<{ values?, errors? }, void>
model.reset;                // Effect<void, void>
```

### Nested units — lens API

`model.fields` mirrors the schema. Leaf fields expose their units as
watch (`clock()`) / dispatch (`target()`) actions; array and shape fields are
collection lenses keyed by a **stable id** (assigned per item at creation, so the
id survives `move` / `swap` / `remove`):

```ts
// leaf field
model.fields.email.state.clock();   // Event<string> — fires on value updates
model.fields.email.change.target(); // EventCallable<string> — dispatch a change

// array field — collection lens
model.fields.phones.state.clock();               // updates across all items
model.fields.phones.ids("0").state.clock();      // one item by stable id
model.fields.phones.where((p) => !!p.value).change.target();
model.fields.phones.first().state.clock();
model.fields.phones.where((p) => !p.value).delete();
```

Selection operators (`ids`, `where`, `first`, `last`, `single`, `delete`,
`getSource`, `props`) match `@effector-kit/models`' lens signature.

## Notes

- Runtime bridging follows `@virentia/effector`: no association or scope in the
  current run → the underlying `fool`ed units throw. Choose scopes with
  `scoped` / effector `allSettled` / `scopeBind` / UI providers.
- `union` / `ref` / instance aliases from `@effector-kit/models` have no analogue
  in a fixed form schema and are intentionally not exposed.
