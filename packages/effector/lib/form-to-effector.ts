import type { Form } from "@virentia/forms";
import { bridgeEvent, bridgeMethod, bridgeStore } from "./bridge";
import { createSchemaLens } from "./lens";
import type { AnyVirentiaUnit, EffectorForm, SchemaLens } from "./types";

type AnyRecord = Record<string, any>;

/**
 * Project a virentia form into an effector-facing model.
 *
 * The virentia form stays the source of truth; this is a bridge (built on
 * `@virentia/effector`'s `fool`), not a reimplementation. Associate the virentia
 * scope with a forked effector scope (`associate(...)`) before driving the
 * result, exactly as the `@virentia/effector` skill describes.
 *
 * - top-level state -> `$`-prefixed effector stores
 * - lifecycle events -> effector events
 * - mutating methods -> effector effects that run inside the virentia scope
 * - nested units -> `fields`, a lens tree shaped like `@effector-kit/models`
 */
export function formToEffector<Schema extends AnyRecord>(
  form: Form<Schema>,
): EffectorForm<Schema> {
  const asUnit = (unit: unknown) => unit as AnyVirentiaUnit;

  return {
    $values: bridgeStore(form.values),
    $value: bridgeStore(form.value),
    $errors: bridgeStore(form.errors),
    $innerErrors: bridgeStore(form.innerErrors),
    $outerErrors: bridgeStore(form.outerErrors),
    $snapshot: bridgeStore(form.snapshot),
    $isChanged: bridgeStore(form.isChanged),
    $isValid: bridgeStore(form.isValid),
    $isValidationPending: bridgeStore(form.isValidationPending),

    filled: bridgeEvent(asUnit(form.filled)),
    changed: bridgeEvent(asUnit(form.changed)),
    errorsChanged: bridgeEvent(asUnit(form.errorsChanged)),
    validated: bridgeEvent(asUnit(form.validated)),
    validationFailed: bridgeEvent(asUnit(form.validationFailed)),
    submitted: bridgeEvent(asUnit(form.submitted)),
    validatedAndSubmitted: bridgeEvent(asUnit(form.validatedAndSubmitted)),

    submit: bridgeMethod(() => form.submit(), "form.submit"),
    validate: bridgeMethod(() => form.validate(), "form.validate"),
    fill: bridgeMethod(
      (payload: Parameters<typeof form.fill>[0]) => form.fill(payload),
      "form.fill",
    ),
    reset: bridgeMethod(() => form.reset(), "form.reset"),
    clearOuterErrors: bridgeMethod(() => form.clearOuterErrors(), "form.clearOuterErrors"),
    clearInnerErrors: bridgeMethod(() => form.clearInnerErrors(), "form.clearInnerErrors"),
    forceUpdateSnapshot: bridgeMethod(() => form.forceUpdateSnapshot(), "form.forceUpdateSnapshot"),

    fields: createSchemaLens(form.fields) as SchemaLens<Form<Schema>["fields"]>,
  } as EffectorForm<Schema>;
}
