import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2]);
const rounds = Number(process.argv[3] ?? 9), samples = [];
const offset = Number(process.argv[4] ?? 0);
const directories = process.argv[5] ? { baseline: path.resolve(process.argv[5]), candidate: path.resolve(process.argv[6]) } : undefined;
const factories = process.argv[7] === "core" ? { baseline: "baseline", candidate: "baseline" } : { baseline: "baseline", candidate: "candidate" };
await mkdir(out, { recursive: true });
for (let round = 0; round < rounds; round++) {
  const order = (round + offset) % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
  const row = { round, order };
  for (const variant of order) {
    row[variant] = await new Promise((resolve, reject) => {
      const loader = directories ? ["--experimental-loader", path.join(root, "core-loader.mjs")] : [];
      const child = spawn(process.execPath, [...loader, path.join(root, "cold.mjs"), factories[variant]],
        { cwd: root, env: { ...process.env, NODE_ENV: "production", ...(directories && { VIRENTIA_CORE_CONTROL_DIR: directories[variant] }) }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve(JSON.parse(stdout)) : reject(Error(stderr)));
    });
  }
  samples.push(row);
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = { rounds, offset, processes: rounds * 2, directories, factories, phases: {} };
for (const phase of ["importMs", "createMs", "firstReadMs", "readyMs"]) {
  summary.phases[phase] = {
    baseline: median(samples.map(row => row.baseline[phase])),
    candidate: median(samples.map(row => row.candidate[phase])),
    medianPairedRatio: median(samples.map(row => row.candidate[phase] / row.baseline[phase])),
  };
}
await writeFile(path.join(out, "samples.json"), JSON.stringify(samples, null, 2) + "\n");
await writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
