import type { Form } from "@virentia/forms";
import { bridgeEvent, bridgeMethod, bridgeScopedMethod, bridgeStore } from "./bridge";
import { boundStoreScopeOf } from "@virentia/core/internal";
import { createFormSchemaLens } from "./lens";
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
  const home = boundStoreScopeOf(form.values);
  const method: typeof bridgeMethod = (run, name) => bridgeScopedMethod(run, name, home);

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

    submit: method(() => form.submit(), "form.submit"),
    validate: method(() => form.validate(), "form.validate"),
    fill: method(
      (payload: Parameters<typeof form.fill>[0]) => form.fill(payload),
      "form.fill",
    ),
    reset: method(() => form.reset(), "form.reset"),
    clearOuterErrors: method(() => form.clearOuterErrors(), "form.clearOuterErrors"),
    clearInnerErrors: method(() => form.clearInnerErrors(), "form.clearInnerErrors"),
    forceUpdateSnapshot: method(() => form.forceUpdateSnapshot(), "form.forceUpdateSnapshot"),

    fields: createFormSchemaLens(() => form.fields) as SchemaLens<Form<Schema>["fields"]>,
  } as EffectorForm<Schema>;
}
