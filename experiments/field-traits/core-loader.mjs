// Isolated Core A/B control: all units AND scope/owner helpers in a child use
// the same saved build. No application modules from different cores are mixed.
import path from "node:path";
import { pathToFileURL } from "node:url";
const directory = process.env.VIRENTIA_CORE_CONTROL_DIR;
export async function resolve(specifier, context, nextResolve) {
  const entry = specifier === "@virentia/core" ? "index.mjs"
    : specifier === "@virentia/core/internal" ? "internal.mjs" : undefined;
  if (directory && entry)
    return { url: pathToFileURL(path.join(directory, entry)).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
