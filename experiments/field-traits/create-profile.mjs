// Creation-only sampling diagnostic. Profiles are not benchmark results.
import { Session } from "node:inspector";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { owner } from "@virentia/core";

const out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const factories = {};
for (const name of ["baseline", "candidate"])
  factories[name] = (await import(`./build/${name}.mjs`)).createField;
const session = new Session();
session.connect();
const post = (method, args = {}) => new Promise((resolve, reject) =>
  session.post(method, args, (error, result) => error ? reject(error) : resolve(result)));
await post("Profiler.enable");
await post("Profiler.setSamplingInterval", { interval: 100 });
for (const name of ["baseline", "candidate"]) {
  for (let n = 0; n < 2; n++) {
    const model = owner(() => ({ fields: Array.from({ length: 50 }, (_, i) => factories[name](i, { meta: { index: i } })) }));
    model.dispose();
  }
  await new Promise(resolve => setImmediate(resolve));
  global.gc();
  await post("Profiler.start");
  const model = owner(() => ({ fields: Array.from({ length: 1000 }, (_, i) => factories[name](i, { meta: { index: i } })) }));
  const { profile } = await post("Profiler.stop");
  await writeFile(path.join(out, `${name}.cpuprofile`), JSON.stringify(profile));
  model.dispose();
}
session.disconnect();
