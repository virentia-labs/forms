import { computed, getCurrentScope, store, type Scope } from "@virentia/core";
import { node, reconcileScopedSource, unwrapMicroScope, type ModelValueContext } from "@virentia/core/internal";
import { fieldRevision } from "./field-state";
import { isFieldContract, isNormalizedField, isPlainObject, type AnyRecord } from "./shared";

type Version = readonly [object, unknown];

/** One resolver/computed graph per form definition, scoped data per instance. */
export function modelSchema(resolve: () => AnyRecord) {
  const fields = computed(() => validateSchema(resolve()));
  const ready = store(false);
  const seen = new WeakMap<Scope, readonly Version[]>();
  const descriptors = new Map<string, PropertyDescriptor>();
  let observe: (() => void) | undefined;
  const schema = new Proxy(Object.create(null), {
    get(_target, key) { return typeof key === "string" ? fields.value[key] : undefined; },
    has(_target, key) { return typeof key === "string" && key in fields.value; },
    ownKeys() { return Reflect.ownKeys(fields.value); },
    getOwnPropertyDescriptor(_target, key) {
      if (typeof key !== "string" || !(key in fields.value)) return;
      let descriptor = descriptors.get(key);
      if (!descriptor) descriptors.set(key, descriptor = {
        configurable: true, enumerable: true, get: () => fields.value[key],
      });
      return descriptor;
    },
  }) as AnyRecord;
  const scope = () => {
    const current = getCurrentScope();
    if (!current) throw new Error("[forms] A model schema requires an instance scope");
    return unwrapMicroScope(current);
  };
  const versions = (): Version[] => {
    const result: Version[] = [];
    const visit = (record: AnyRecord): void => {
      for (const field of Object.values(record)) {
        if (isFieldContract(field)) {
          const revision = (field as unknown as Record<symbol, { value: unknown }>)[fieldRevision];
          result.push([field, revision ? revision.value : field.state.value]);
        } else visit(field);
      }
    };
    visit(schema);
    return result;
  };
  const revisions = computed(() => ready.value ? versions() : []);
  const changed = (next: readonly Version[]): boolean => {
    const current = scope(), previous = seen.get(current);
    if (previous && previous.length === next.length && previous.every((value, i) => value[0] === next[i][0] && Object.is(value[1], next[i][1]))) return false;
    seen.set(current, next);
    return previous !== undefined;
  };
  // One shared endpoint, attached only in initialized instance scopes. Global
  // computed observation would evaluate self/children in an application scope.
  const endpoint = node(ctx => {
    if (changed(ctx.value as readonly Version[])) observe?.();
  });
  return {
    schema, ready,
    bind(context: ModelValueContext) {
      const bound = context.bind(fields);
      const record = (read: () => AnyRecord): AnyRecord => {
        const nested = new Map<string, AnyRecord>();
        const view = new Proxy(Object.create(null), {
          get(_target, key) {
            if (typeof key !== "string") return;
            const value = read()[key];
            if (isFieldContract(value)) return context.bind(value);
            if (!isPlainObject(value)) return value;
            let child = nested.get(key);
            if (!child) nested.set(key, child = record(() => read()[key] ?? {}));
            return child;
          },
          has(_target, key) { return key in read(); },
          ownKeys() { return Reflect.ownKeys(read()); },
          getOwnPropertyDescriptor(_target, key) {
            if (!(key in read())) return;
            return { configurable: true, enumerable: true, get: () => Reflect.get(view, key) };
          },
        });
        return view;
      };
      // Let the bound computed register the caller's cross-scope bridge before
      // entering the form scope, or external readers miss ref replacement.
      return record(() => bound.value);
    },
    initialize() {
      if (ready.value) return;
      ready.value = true;
      if (observe) {
        seen.set(scope(), revisions.value);
        reconcileScopedSource(scope(), endpoint, revisions.node);
      }
    },
    observe(callback: () => void) { observe = callback; },
  };
}

function validateSchema(schema: AnyRecord): AnyRecord {
  for (const value of Object.values(schema)) {
    if (isFieldContract(value)) {
      if (!isNormalizedField(value)) throw new Error("[forms] Model schemas require complete fields declared in setup; normalize custom fields before creating instances");
    } else if (isPlainObject(value)) validateSchema(value);
    else throw new Error("[forms] Model schemas must return declared fields; put raw values in a static schema or use fieldModel");
  }
  return schema;
}
