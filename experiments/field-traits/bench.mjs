import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2]);
const rounds = Number(process.argv[3] ?? 9), size = Number(process.argv[4] ?? 1000);
const offset = Number(process.argv[5] ?? 0);
await mkdir(out, { recursive: true });
const samples = [];
for (let round = 0; round < rounds; round++) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--expose-gc", path.join(root, "worker.mjs"), String(round + offset), String(size)],
      { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve({ stdout, stderr }) : reject(Error(`round ${round}: ${code}\n${stderr}\n${stdout}`)));
  });
  const data = JSON.parse(result.stdout.trim()); samples.push(data);
  await writeFile(path.join(out, `${round}.json`), JSON.stringify(data, null, 2) + "\n");
  console.log(`round ${round + 1}/${rounds}: ${data.order.join(" → ")}`);
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = { rounds, size, offset, phases: {}, memory: {}, counts: samples[0].counts };
for (const category of ["times", "memory"]) {
  const target = category === "times" ? summary.phases : summary.memory;
  for (const phase of Object.keys(samples[0].samples.baseline[category])) {
    const baseline = median(samples.map(row => row.samples.baseline[category][phase]));
    const candidate = median(samples.map(row => row.samples.candidate[category][phase]));
    const ratios = samples.map(row => row.samples.candidate[category][phase] / row.samples.baseline[category][phase]);
    target[phase] = { baseline, candidate, medianPairedRatio: median(ratios),
      candidateFasterRounds: ratios.filter(ratio => ratio < 1).length };
  }
}
await writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
