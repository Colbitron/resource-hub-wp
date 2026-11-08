import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SAMPLED_URLS } from "../e2e/sampled-urls.mts";

// The config CI reads (lighthouserc.cjs), loaded in a fresh Node process as
// lhci and lighthouse-merge.mts load it, with the environment under test
// and none of the caller's Lighthouse settings. CI runs and asserts five
// runs per URL, and the medians job's coverage check reads numberOfRuns
// from this same config, so a default below five here would weaken both.

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const LIGHTHOUSE_PATHS = SAMPLED_URLS.filter((sample) => sample.lighthouse).map((sample) => sample.path);

function loadConfig(env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const base: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(base)) {
    if (name.startsWith("RH_LIGHTHOUSE_") || name === "CI") delete base[name];
  }
  const result = spawnSync(
    process.execPath,
    ["-e", 'const c = require("./lighthouserc.cjs").ci.collect; console.log(JSON.stringify({ runs: c.numberOfRuns, paths: c.url.map((u) => { const url = new URL(u); return url.pathname + url.search; }) }));'],
    { cwd: APP_DIR, encoding: "utf8", env: { ...base, ...env } },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function collect(env: Record<string, string>): { runs: number; paths: string[] } {
  const { status, stdout, stderr } = loadConfig(env);
  expect(status, stderr).toBe(0);
  return JSON.parse(stdout);
}

describe("lighthouserc.cjs", () => {
  it("measures every sampled Lighthouse URL at least five times when nothing overrides it, in CI and off it", () => {
    for (const env of [{}, { CI: "true" }] as Record<string, string>[]) {
      const { runs, paths } = collect(env);
      expect(runs).toBeGreaterThanOrEqual(5);
      expect(paths).toEqual(LIGHTHOUSE_PATHS);
    }
  });

  it("takes the quick settings off CI", () => {
    expect(collect({ RH_LIGHTHOUSE_RUNS: "1", RH_LIGHTHOUSE_URLS: "/resources/" })).toEqual({ runs: 1, paths: ["/resources/"] });
  });

  it("refuses the quick settings in CI", () => {
    for (const name of ["RH_LIGHTHOUSE_RUNS", "RH_LIGHTHOUSE_URLS"]) {
      const { status, stderr } = loadConfig({ CI: "true", [name]: name === "RH_LIGHTHOUSE_RUNS" ? "1" : "/resources/" });
      expect(status).not.toBe(0);
      expect(stderr).toMatch(new RegExp(`${name} is a local smell-test setting`));
    }
  });

  it("fails on a URL filter that names no sampled Lighthouse URL", () => {
    const { status, stderr } = loadConfig({ RH_LIGHTHOUSE_URLS: "/no-such-page/" });
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/not a sampled Lighthouse URL/);
  });
});
