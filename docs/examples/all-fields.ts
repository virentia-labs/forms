import { children, staticModel } from "@virentia/core/models";
import { createField, createForm, fieldType, type CreateFieldOptions } from "@virentia/forms";
import { arrayFieldModel, fieldModel, shapeFieldModel } from "@virentia/forms/models";

const CanonicalText = fieldType({
  create: (initial: string, options?: CreateFieldOptions<string>) => createField(initial, options),
}).extend({
  create(base, initial: string, options?: CreateFieldOptions<string>) {
    const field = base(initial, options);
    return { ...field, normalize: () => field.fill(field.read().trim().toLowerCase()) };
  },
});

export const Email = fieldModel("", {
  name: "GuideAllEmail", validate: value => value.includes("@") ? null : "Invalid email",
});
export const Label = fieldModel("", {
  name: "GuideAllLabel", create: (initial, options) => CanonicalText(initial, options),
});
export const Phones = arrayFieldModel([""], { name: "GuideAllPhones" });
export const Contact = shapeFieldModel({ email: Email, label: Label, phones: Phones }, { name: "GuideAllContact" });
export const Contacts = arrayFieldModel([], { item: Contact, name: "GuideAllContacts" });

export const Profile = staticModel({
  name: "GuideAllProfile",
  data: { email: children.one(Email), phones: children.one(Phones), contact: children.one(Contact), contacts: children.one(Contacts) },
  setup(self) { return { form: createForm({ schema: () => ({
    email: self.email.value!.field, phones: self.phones.value!.field,
    contact: self.contact.value!.field, contacts: self.contacts.value!.field,
  }) }) }; },
  onCreate(self) {
    if (!self.email.value) self.email.create({});
    if (!self.phones.value) self.phones.create({});
    if (!self.contact.value) self.contact.create({});
    if (!self.contacts.value) self.contacts.create({});
  },
});
