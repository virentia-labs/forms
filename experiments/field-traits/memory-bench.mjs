import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2]), rounds = Number(process.argv[3] ?? 9), size = Number(process.argv[4] ?? 1000);
await mkdir(out, { recursive: true });
const samples = [];
for (let round = 0; round < rounds; round++) {
  const order = round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
  const row = { round, order };
  for (const variant of order) row[variant] = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--expose-gc", path.join(root, "memory-worker.mjs"), variant, String(size)],
      { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(JSON.parse(stdout)) : reject(Error(stderr)));
  });
  samples.push(row);
  console.log(`memory pair ${round + 1}/${rounds}: ${order.join(" → ")}`);
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = { rounds, processes: rounds * 2, size, phases: {} };
for (const phase of ["module", "created", "firstRead", "active", "released"]) summary.phases[phase] = {
  baseline: median(samples.map(row => row.baseline[phase])),
  candidate: median(samples.map(row => row.candidate[phase])),
  medianPairedRatio: median(samples.map(row => row.candidate[phase] / row.baseline[phase])),
};
summary.collection = Object.fromEntries(["baseline", "candidate"].map(name => [name, {
  api: samples.filter(row => row[name].apiCollected).length,
  node: samples.filter(row => row[name].nodeCollected).length,
  ambientScopeRestored: samples.filter(row => row[name].ambientScope).length,
}]));
await writeFile(path.join(out, "samples.json"), JSON.stringify(samples, null, 2) + "\n");
await writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
