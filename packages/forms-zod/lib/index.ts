import type { FieldError, FieldValidator, FormValidator, ValidationContext } from "@virentia/forms";
import type { ZodType } from "zod";

type SchemaFactory<Schema> = Schema | ((ctx: ValidationContext) => Schema);
type AnyZodSchema = ZodType<any, any, any>;
type ZodOutput<Schema> = Schema extends ZodType<infer Output, any, any> ? Output : never;

export function zodValidator<Schema extends AnyZodSchema>(
  schema: SchemaFactory<Schema>,
): FormValidator<ZodOutput<Schema>, any> {
  return async (values: ZodOutput<Schema>, ctx: ValidationContext) => {
    const result = await resolveSchema(schema, ctx).safeParseAsync(values);

    if (result.success) {
      return null;
    }

    return zodIssuesToErrors(result.error.issues);
  };
}

export function zodFieldValidator<Schema extends AnyZodSchema>(
  schema: SchemaFactory<Schema>,
): FieldValidator<ZodOutput<Schema>, FieldError> {
  return async (value: ZodOutput<Schema>, ctx: ValidationContext) => {
    const result = await resolveSchema(schema, ctx).safeParseAsync(value);

    if (result.success) {
      return null;
    }

    return result.error.issues[0]?.message ?? "Invalid value";
  };
}

export const zodFormValidator = zodValidator;

function resolveSchema<Schema>(schema: SchemaFactory<Schema>, ctx: ValidationContext): Schema {
  return typeof schema === "function" ? (schema as (ctx: ValidationContext) => Schema)(ctx) : schema;
}

function zodIssuesToErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  const errors: Record<string, unknown> = {};

  for (const issue of issues) {
    setPathError(errors, issue.path, issue.message);
  }

  return errors;
}

function setPathError(target: Record<string, unknown>, path: readonly PropertyKey[], message: string): void {
  if (path.length === 0) {
    target._form = message;
    return;
  }

  let cursor: Record<string, unknown> = target;

  for (let index = 0; index < path.length; index += 1) {
    const key = String(path[index]);

    if (index === path.length - 1) {
      if (!(key in cursor)) {
        cursor[key] = message;
      }
      return;
    }

    const next = cursor[key];

    if (!next || typeof next !== "object") {
      cursor[key] = {};
    }

    cursor = cursor[key] as Record<string, unknown>;
  }
}
