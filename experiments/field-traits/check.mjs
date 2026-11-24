import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url)), forms = path.resolve(root, "../..");
const out = path.resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const report = { checks: [], success: false, complete: false };
const save = () => writeFile(path.join(out, "summary.json"), JSON.stringify(report, null, 2) + "\n");
const run = async (label, cwd, args) => {
  const check = { label, cwd, args, startedAt: new Date().toISOString() };
  report.checks.push(check); await save();
  let stdout = "", stderr = "";
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env,
    PATH: [path.join(forms, "node_modules/.bin"), process.env.PATH].join(path.delimiter) }, stdio: ["ignore", "pipe", "pipe"] });
  check.pid = child.pid; await save();
  child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
  check.exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  check.finishedAt = new Date().toISOString();
  await writeFile(path.join(out, label + ".log"), stdout + stderr); await save();
  if (check.exitCode !== 0) throw new Error(`${label} failed`);
  console.log(`Passed ${label}`);
};
try {
  const vitest = path.join(forms, "node_modules/vitest/vitest.mjs");
  await run("candidate-types", forms, [path.join(forms, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", path.join(root, "tsconfig.json")]);
  for (const name of ["forms", "forms-react", "forms-zod", "effector"]) {
    await run(`${name}-candidate-runtime`, path.join(forms, "packages", name), [vitest, "run", "--threads", "false", "--config", path.join(root, "vitest.config.ts")]);
  }
  const ecosystem = path.resolve(forms, "../virentia/ecosystem");
  const ecosystemVitest = path.resolve(forms, "../virentia/node_modules/vitest/vitest.mjs");
  await run("ecosystem-candidate-runtime", ecosystem, [ecosystemVitest, "run", "--threads", "false", "--config", path.join(root, "vitest.config.ts")]);
  report.success = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally { report.complete = true; await save(); }
