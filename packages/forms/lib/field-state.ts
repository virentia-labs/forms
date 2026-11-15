// A static model supplies its scoped cells while declaring the shared Field
// graph. Ordinary createField calls still construct their native cells directly.
export interface FieldCell<T = any> { value: T }
export interface FieldState {
  value: FieldCell;
  meta: FieldCell<object>;
  focused: FieldCell<boolean>;
  innerError: FieldCell<string | null>;
  outerError: FieldCell<string | null>;
  initialValue: FieldCell;
  initialMeta: FieldCell<object>;
  initialOuterError: FieldCell<string | null>;
  revision: FieldCell<number>;
  captureDefaults?(value: unknown, meta: object, error: string | null): void;
}
export const fieldRevision = Symbol.for("virentia.forms.field.revision");
export function trackFieldRevisions(fields: Iterable<object>): void {
  for (const field of fields) {
    const revision = (field as Record<symbol, FieldCell | undefined>)[fieldRevision];
    if (revision) void revision.value;
  }
}
let active: FieldState | undefined;
export function fieldState(): FieldState | undefined { return active; }
export function withFieldState<T>(state: FieldState, run: () => T): T {
  const previous = active;
  active = state;
  try { return run(); } finally { active = previous; }
}
