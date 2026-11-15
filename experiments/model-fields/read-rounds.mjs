import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const [beforeArg, afterArg, outArg, roundsArg = "9", passesArg = "200"] = process.argv.slice(2);
const cores = { before: path.resolve(beforeArg), after: path.resolve(afterArg) }, out = path.resolve(outArg), rounds = Number(roundsArg);
await mkdir(out, { recursive: true });
const results = [];
for (let round = 0; round < rounds; round++) {
  const order = round % 2 ? ["after", "before"] : ["before", "after"], samples = {};
  for (const side of order) {
    const output = path.join(out, `${round}-${side}.json`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, "read-probe.mjs"), cores[side], output, "timing", "500", passesArg], { stdio: ["ignore", "ignore", "pipe"] });
      let errors = ""; child.stderr.on("data", data => { errors += data; });
      child.on("error", reject); child.on("close", code => code ? reject(Error(errors)) : resolve());
    });
    samples[side] = JSON.parse(await readFile(output));
  }
  results.push({ round, order, samples }); console.log(`${round + 1}/${rounds}`);
}
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const summary = { cores, rounds, passes: Number(passesArg), times: {} };
for (const key of Object.keys(results[0].samples.before.times)) {
  const before = results.map(r => r.samples.before.times[key]), after = results.map(r => r.samples.after.times[key]), ratios = before.map((v, i) => after[i] / v);
  summary.times[key] = { before: median(before), after: median(after), ratio: median(ratios), wins: ratios.filter(v => v < 1).length, ratios };
}
await writeFile(path.join(out, "rounds.json"), JSON.stringify(results, null, 2) + "\n");
await writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
