import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url)), out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const results = [];
for (let round = 0; round < 9; round++) {
  const order = round % 2 ? ["after", "before"] : ["before", "after"], samples = {};
  for (const name of order) samples[name] = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--expose-gc", path.join(root, "dispatch-worker.mjs"), name, "500"],
      { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { errors += data; });
    child.on("error", reject); child.on("close", code => code ? reject(Error(errors)) : resolve(JSON.parse(output)));
  });
  results.push({ round, order, samples });
  await writeFile(path.join(out, `${round}.json`), JSON.stringify(results.at(-1), null, 2) + "\n");
  console.log(`${round + 1}/9`);
}
const median = values => [...values].sort((a, b) => a - b)[4];
const summary = { rounds: 9, count: 500, repeats: 20, before: median(results.map(row => row.samples.before.median)),
  after: median(results.map(row => row.samples.after.median)), ratio: median(results.map(row => row.samples.after.median / row.samples.before.median)),
  wins: results.filter(row => row.samples.after.median < row.samples.before.median).length };
await writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
