import { performance } from "node:perf_hooks";
const measured = async name => {
  const start = performance.now(); await import(name); return performance.now() - start;
};
const core = await measured("@virentia/core");
const models = await measured("@virentia/core/models");
const candidateAfterModels = await measured("./build/candidate.mjs");
const baselineAfterCore = await measured("./build/baseline.mjs");
console.log(JSON.stringify({ core, models, candidateAfterModels, baselineAfterCore }, null, 2));
