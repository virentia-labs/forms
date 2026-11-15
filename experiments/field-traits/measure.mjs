import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url)), out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const report = { steps: [], sourceHashes: {}, complete: false, success: false };
for (const file of ["baseline.ts", "field.ts", "worker.mjs", "memory-worker.mjs", "../../packages/forms/lib/field.ts", "../../packages/forms/lib/shared.ts"])
  report.sourceHashes[file] = createHash("sha256").update(await readFile(path.resolve(root, file))).digest("hex");
const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.resolve("@virentia/core"))), "..");
report.coreRoot = coreRoot;
for (const file of ["lib/internal.ts", "lib/models/native.ts", "lib/units/store.ts", "lib/kernel/inspector.ts", "lib/kernel/transaction.ts",
  ...(await readdir(path.join(coreRoot, "dist"))).filter(name => name.endsWith(".mjs")).map(name => `dist/${name}`)])
  report.sourceHashes[`core/${file}`] = createHash("sha256").update(await readFile(path.join(coreRoot, file))).digest("hex");
const save = () => writeFile(path.join(out, "run.json"), JSON.stringify(report, null, 2) + "\n");
const run = async (name, script, args) => {
  const step = { name, script, args, startedAt: new Date().toISOString() };
  report.steps.push(step); await save();
  const child = spawn(process.execPath, [path.join(root, script), ...args],
    { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
  step.pid = child.pid; await save();
  let output = "";
  child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
  step.exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  step.finishedAt = new Date().toISOString();
  await writeFile(path.join(out, `${name}.log`), output); await save();
  if (step.exitCode !== 0) throw new Error(`${name} failed`);
  console.log(`Passed ${name}`);
};
try {
  await run("build", "build.mjs", []);
  await run("counters", "counters.mjs", []);
  await run("runtime", "bench.mjs", [path.join(out, "runtime"), "9", "1000", "0"]);
  await run("memory", "memory-bench.mjs", [path.join(out, "memory"), "9", "1000"]);
  await run("cold", "cold-bench.mjs", [path.join(out, "cold"), "9"]);
  report.success = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally { report.complete = true; await save(); }
