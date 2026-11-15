import type { Store } from "@virentia/core";
import type { InstanceOf } from "@virentia/core/models";
import { createField, fieldType, type Field } from "@virentia/forms";
import { arrayFieldModel, fieldModel, shapeFieldModel } from "@virentia/forms/models";

const Email = fieldModel("", { meta: { label: "Email" } });
const Emails = arrayFieldModel([], { item: Email });
declare const emails: InstanceOf<typeof Emails>;
emails.field.push("typed@example.com");
const email: Field<string, { label: string }> = emails.field.items.value[0];
const listValues: Store<readonly string[]> = emails.value;
// @ts-expect-error the item model infers string even for an empty initial array
emails.field.push(42);
// @ts-expect-error initial values must match the declared item model
arrayFieldModel([42], { item: Email });

const Person = shapeFieldModel({ email: Email, age: 0 });
declare const person: InstanceOf<typeof Person>;
person.field.fill({ email: "typed", age: 42 });
const shapeValues: Store<{ email: string; age: number }> = person.value;
person.field.fields.value.email.fill("typed");
// @ts-expect-error typed shape values retain their scalar types
person.field.fill({ age: "42" });
// @ts-expect-error fields preserve the configured model's payload
person.field.fields.value.email.fill(42);
const People = arrayFieldModel([], { item: Person });
declare const people: InstanceOf<typeof People>;
people.field.push({ email: "typed", age: 42 });
// @ts-expect-error nested shape values are checked when adding array items
people.field.push({ age: "42" });

const Upper = fieldType({ create: (initial: string) => createField(initial) }).extend({
  create(base, initial: string) { const field = base(initial); return { ...field, uppercase: () => field.fill(field.read().toUpperCase()) }; },
});
const Text = fieldModel("", { create: initial => Upper(initial) });
declare const text: InstanceOf<typeof Text>;
const result: Promise<void> = text.field.uppercase();
text.field.fill("typed");
// @ts-expect-error custom extensions retain the underlying scalar payload type
text.field.fill(42);
void [email, listValues, shapeValues, result];
