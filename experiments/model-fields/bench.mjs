import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2], out = path.resolve(process.argv[3]), rounds = Number(process.argv[4] ?? 9), size = Number(process.argv[5] ?? 500);
const participants = () => ["legacy", "aa", "bb"].includes(mode) ? ["before", "after"] : mode === "fields" ? ["baseline", "candidate"] : ["dynamic", "model"];
await mkdir(out, { recursive: true });
const results = [];
for (let round = 0; round < rounds; round++) {
  const names = participants();
  const order = round % 2 ? names.reverse() : names;
  const result = { round, size, mode, order, samples: {} };
  for (const name of order) {
  const isolated = await new Promise((resolve, reject) => {
    const args = mode === "fields" ? [path.join(root, "field-worker.mjs"), String(round), String(size), name]
      : [path.join(root, "worker.mjs"), ["aa", "bb"].includes(mode) ? "legacy" : mode, String(round), String(size), name,
        mode === "aa" ? "before" : mode === "bb" ? "after" : ""];
    const child = spawn(process.execPath, ["--expose-gc", ...args],
      { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { errors += data; });
    child.on("error", reject); child.on("close", code => code ? reject(Error(`${code}: ${errors}\n${output}`)) : resolve(JSON.parse(output)));
  });
  Object.assign(result.samples, isolated.samples);
  if (mode === "fields") result.samples[name].declarations = isolated.counts[name];
  result.node = isolated.node;
  }
  results.push(result);
  await writeFile(path.join(out, `${round}.json`), JSON.stringify(result, null, 2) + "\n");
  console.log(`${round + 1}/${rounds}: ${result.order.join(" → ")}`);
}
const [baseline, candidate] = participants();
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = { mode, rounds, size, baseline, candidate, times: {}, memory: {}, declarations: results[0].samples };
for (const category of ["times", "memory"]) for (const key of Object.keys(results[0].samples[baseline][category])) {
  const ratios = results.map(row => row.samples[candidate][category][key] / row.samples[baseline][category][key]);
  summary[category][key] = { baseline: median(results.map(row => row.samples[baseline][category][key])),
    candidate: median(results.map(row => row.samples[candidate][category][key])), ratio: median(ratios), wins: ratios.filter(value => value < 1).length };
}
summary.declarations = Object.fromEntries(Object.entries(summary.declarations).map(([name, sample]) => [name, sample.declarations]));
await writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
