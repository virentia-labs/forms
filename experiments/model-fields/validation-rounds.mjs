import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const [phase, mode, target, rounds = "9", size = "500", passes = "20"] = process.argv.slice(2);
if (!["field", "form"].includes(phase) || !["ab", "aa", "bb"].includes(mode)) throw new Error("Invalid phase/control");
const out = path.resolve(target);
await mkdir(out, { recursive: true });
const result = [];
for (let round = 0; round < Number(rounds); round++) {
  const order = round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
  const row = { round, phase, mode, order, samples: {} };
  for (const side of order) {
    const participant = mode === "aa" ? "original" : mode === "bb" ? "retained" : side === "baseline" ? "original" : "retained";
    const prefix = path.join(out, `${round}-${side}`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--expose-gc", path.join(root, "validation-probe.mjs"), participant, phase, "timing", prefix, size, passes],
        { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
      let errors = "";
      child.stdout.resume(); child.stderr.on("data", data => { errors += data; });
      child.on("error", reject); child.on("close", code => code ? reject(Error(`${code}: ${errors}`)) : resolve());
    });
    row.samples[side] = JSON.parse(await readFile(`${prefix}.json`, "utf8"));
  }
  result.push(row);
  await writeFile(path.join(out, `${round}.json`), JSON.stringify(row, null, 2) + "\n");
  console.log(`${round + 1}/${rounds}: ${order.join(" → ")}`);
}
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sum = xs => xs.reduce((a, b) => a + b, 0);
const summary = { phase, mode, rounds: Number(rounds), size: Number(size), passes: Number(passes), node: process.version, times: {} };
for (const [key, value] of Object.entries({ total: sample => sum(sample.times), first: sample => sample.times[0], rest: sample => sum(sample.times.slice(1)) })) {
  const baseline = result.map(row => value(row.samples.baseline)), candidate = result.map(row => value(row.samples.candidate));
  const ratios = baseline.map((time, i) => candidate[i] / time);
  summary.times[key] = { baseline: median(baseline), candidate: median(candidate), ratio: median(ratios), wins: ratios.filter(x => x < 1).length };
}
await writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
