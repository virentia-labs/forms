// Compare two Core runtimes with the same Forms source and complete phases.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const [scenario, controlArg, target, roundsArg = "9", sizeArg = "500"] = process.argv.slice(2);
assert.ok(["model", "native"].includes(scenario));
const control = path.resolve(controlArg), out = path.resolve(target), rounds = Number(roundsArg), size = Number(sizeArg);
await mkdir(out, { recursive: true });
const redirect = code => {
  for (const [specifier, entry] of [["@virentia/core", "index"], ["@virentia/core/internal", "internal"], ["@virentia/core/models", "models"]])
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(path.join(control, "dist", `${entry}.mjs`)));
  return code;
};
const candidateModule = scenario === "model" ? "model" : "after";
const controlModule = `${scenario}-core-control`;
const bundle = await readFile(path.join(root, "build", `${candidateModule}.mjs`), "utf8");
await writeFile(path.join(root, "build", `${controlModule}.mjs`), redirect(bundle));
const worker = await readFile(path.join(root, "worker.mjs"), "utf8");
const controlWorker = path.join(root, "build", "worker-core-control.mjs");
await writeFile(controlWorker, redirect(worker).replace('import(`./build/${moduleOverride ?? name}.mjs`)', 'import(`./${moduleOverride ?? name}.mjs`)'));
const hash = code => createHash("sha256").update(code).digest("hex");
await writeFile(path.join(out, "inputs.json"), JSON.stringify({ scenario, node: process.version, control,
  core: Object.fromEntries(await Promise.all(["index", "internal", "models"].map(async entry => [entry,
    { control: hash(await readFile(path.join(control, "dist", `${entry}.mjs`))),
      candidate: hash(await readFile(fileURLToPath(import.meta.resolve(`@virentia/core${entry === "index" ? "" : `/${entry}`}`)))) }]))),
  formsBundle: hash(bundle), worker: hash(worker), controlWorker: hash(await readFile(controlWorker)),
}, null, 2) + "\n");
const results = [];
for (let round = 0; round < rounds; round++) {
  const order = round % 2 ? ["after", "before"] : ["before", "after"];
  const row = { round, scenario, size, order, samples: {} };
  for (const side of order) {
    const text = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--expose-gc", side === "before" ? controlWorker : path.join(root, "worker.mjs"),
        "legacy", String(round), String(size), side, side === "before" ? controlModule : candidateModule],
      { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "", errors = "";
      child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { errors += data; });
      child.on("error", reject); child.on("close", code => code ? reject(Error(`${code}: ${errors}\n${output}`)) : resolve(output));
    });
    row.samples[side] = JSON.parse(text).samples[side];
    if (scenario === "model") assert.deepEqual(row.samples[side].declarations.instances, {});
  }
  results.push(row);
  await writeFile(path.join(out, `${round}.json`), JSON.stringify(row, null, 2) + "\n");
  console.log(`${round + 1}/${rounds}: ${order.join(" → ")}`);
}
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const summary = { scenario, rounds, size, times: {}, memory: {}, declarations: Object.fromEntries(Object.entries(results[0].samples).map(([k, v]) => [k, v.declarations])) };
for (const category of ["times", "memory"]) for (const key of Object.keys(results[0].samples.before[category])) {
  const before = results.map(row => row.samples.before[category][key]), after = results.map(row => row.samples.after[category][key]);
  const ratios = before.map((value, i) => after[i] / value);
  summary[category][key] = { baseline: median(before), candidate: median(after),
    ...(key === "released" ? {} : { ratio: median(ratios), wins: ratios.filter(value => value < 1).length }) };
}
await writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
