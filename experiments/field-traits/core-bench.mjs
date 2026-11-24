import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2]);
const directories = { before: path.resolve(process.argv[3]), after: path.resolve(process.argv[4]) };
const rounds = Number(process.argv[5] ?? 9), offset = Number(process.argv[6] ?? 0);
const mode = process.argv[7] ?? "core";
if (!["core", "field"].includes(mode)) throw new Error("Invalid control mode");
const factories = { before: "baseline", after: mode === "field" ? "candidate" : "baseline" };
await mkdir(out, { recursive: true });
const samples = [];
for (let round = 0; round < rounds; round++) {
  const order = (round + offset) % 2 ? ["after", "before"] : ["before", "after"];
  const row = { round, order, samples: {} };
  for (const name of order) {
    const child = spawn(process.execPath, ["--expose-gc", "--experimental-loader", path.join(root, "core-loader.mjs"),
      path.join(root, "worker.mjs"), String(round), "1000", factories[name]], {
      cwd: root, env: { ...process.env, NODE_ENV: "production", VIRENTIA_CORE_CONTROL_DIR: directories[name] },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    const exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    if (exitCode !== 0) throw new Error(`${name}: ${exitCode}\n${stderr}\n${stdout}`);
    const result = JSON.parse(stdout.trim());
    row.samples[name] = result.samples[factories[name]];
    row.samples[name].pid = child.pid;
  }
  samples.push(row);
  await writeFile(path.join(out, `${round}.json`), JSON.stringify(row, null, 2) + "\n");
  console.log(`round ${round + 1}/${rounds}: ${order.join(" → ")}`);
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = { rounds, offset, mode, directories, factories, phases: {}, memory: {} };
for (const category of ["times", "memory"]) {
  const target = category === "times" ? summary.phases : summary.memory;
  for (const phase of Object.keys(samples[0].samples.before[category])) {
    const ratios = samples.map(row => row.samples.after[category][phase] / row.samples.before[category][phase]);
    target[phase] = {
      before: median(samples.map(row => row.samples.before[category][phase])),
      after: median(samples.map(row => row.samples.after[category][phase])),
      medianPairedRatio: median(ratios), afterFasterRounds: ratios.filter(ratio => ratio < 1).length,
    };
  }
}
await writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
