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

## Owned fields and forms

Declare each field definition once. A form owns independent child instances;
use refs only when several forms intentionally edit the same field.

```ts
import { scope, scoped } from "@virentia/core";
import { children, staticModel } from "@virentia/core/models";
import { createForm } from "@virentia/forms";
import { arrayFieldModel, fieldModel, shapeFieldModel } from "@virentia/forms/models";

const Email = fieldModel("", {
  name: "Email", validate: value => value.includes("@") ? null : "Invalid email",
});
const Phones = arrayFieldModel([""], { name: "Phones" });
const Details = shapeFieldModel({ name: "", nickname: "" }, { name: "Details" });

export const Profile = staticModel({
  name: "Profile",
  data: { email: children.one(Email), phones: children.one(Phones), details: children.one(Details) },
  setup(self) {
    return { form: createForm({ schema: () => ({
      email: self.email.value!.field,
      phones: self.phones.value!.field,
      details: self.details.value!.field,
    }) }) };
  },
  onCreate(self) {
    if (!self.email.value) self.email.create({});
    if (!self.phones.value) self.phones.create({});
    if (!self.details.value) self.details.create({});
  },
});

const app = scope();
const profile = scoped(app, () => Profile.create({ id: "profile" }));
await profile.form.fill({ values: {
  email: "ada@example.com", phones: ["123"], details: { name: "Ada" },
} });
await profile.phones.value!.field.push("456");
await profile.dispose();
```

Scalar `fieldModel`, `arrayFieldModel` and `shapeFieldModel` use traits and one
shared unit graph per definition. Instances and newly created collection items
declare no additional units. Resolve `schema: () => ...` inside the model's
`setup`; create children from DTOs or synchronous `onCreate`.

### Collection fields

Pass an existing item definition when its validation or behavior is reused:

```ts
const Phone = fieldModel("", { name: "Phone" });
const ReusablePhones = arrayFieldModel([""], { item: Phone, name: "ReusablePhones" });
const Contact = shapeFieldModel({ email: Email, phones: ReusablePhones, label: "" }, { name: "Contact" });
const Contacts = arrayFieldModel([], { item: Contact, name: "Contacts" });
```

Use the existing `.field` API: `push`, `move`, `fill`, `reset`, `fields`, `items`
and validation. `.value` on a collection model is the derived readonly store.
Created items belong to the collection and are disposed when removed. Existing
fields passed to `push`/`add` are refs; their original owner keeps their lifetime.
Their definitions must be declared through `item`, the shape schema or
`additional`. Collections reject fields from another application scope.

`json()` round-trips membership, order and owned child DTOs, including without a
scope snapshot. For hydration with original reset state, metadata and errors,
transfer the scope snapshot too and use stable model names/SIDs and root IDs.

### Custom fields and wizards

Pass a custom `fieldType` through `fieldModel(initial, { create })`. Build on
`createField`/the extension's `base` so the custom methods use the model's trait
cells for value, metadata, focus, validation and reset.

Return `createWizard`/`createWizardForm` directly from `setup`. Their methods,
stores, root form and forms in `steps`, `visibleSteps`, `currentStep` and
`currentForm` stay bound. Declare `form.pick(...)` projections in `setup` too.
Native Forms APIs opt into model binding; arbitrary application objects keep
their existing behavior. `.static()` is a separate module graph when that
lifetime is intended.

See the [complete executable field example](../../docs/examples/all-fields.ts)
and [ownership, sharing and SSR guide](../../docs/field-models.md).

## Native API compatibility

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
