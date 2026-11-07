/**
 * Runs Lighthouse CI (`lighthouserc.cjs`) against the built app and the mock
 * CMS, the same two servers the Playwright suite starts, and prints the
 * median of each budgeted number per URL.
 *
 *   node e2e/lighthouse.mts
 *
 * Builds the app with the test environment (`appServerEnv`) first and
 * stamps the build (`build-stamp.mts`), unless `RH_E2E_PREBUILT=1` says the
 * build in `.next` is already that one, as in CI after the end-to-end run;
 * then the stamp must say so, or the run stops before starting anything.
 * Then it clears the fetch cache, starts the mock and `next start` on the
 * harness's ports (refusing a port something already answers on, and
 * failing at once if either server exits while it waits), requests each URL
 * once so Lighthouse measures the
 * cached page a reader gets rather than its first render, and calibrates the
 * CPU slowdown: three quick Lighthouse runs of `/` (performance only) measure
 * the host's `benchmarkIndex`, and their median sets the multiplier
 * (`cpu-calibration.mts`, which stops the run on a host outside its bounds).
 * The calibration costs about 30 s; its reports are discarded. Then it runs
 * `lhci collect` with that multiplier, `lhci upload` (to
 * `lighthouse-results/`) and `lhci assert`, in that order, so the reports are
 * written even when a budget fails, and checks that every run used the
 * calibrated multiplier. The exit code is the assertion's. Both servers are
 * stopped at the end.
 *
 * The medians, with each URL's measured `benchmarkIndex` and multiplier and
 * the calibration's formula and reference device, are printed, and appended
 * to `$GITHUB_STEP_SUMMARY` in CI.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createRequire } from "node:module";

import { assertPrebuilt, writeBuildStamp } from "./build-stamp.mts";
import { appServerEnv, appSiteOrigin, mockCmsOrigin, mockCmsPort, prebuilt, webPort } from "./mock-cms/config.mts";
import { calibratedSlowdown, FORMULA, REFERENCE_DEVICE } from "./cpu-calibration.mts";
import { median, medianTable, type Calibration, type Lhr } from "./lighthouse-summary.mts";
import { SAMPLED_URLS } from "./sampled-urls.mts";

const APP_DIR = new URL("..", import.meta.url).pathname;
const RAW_DIR = join(APP_DIR, ".lighthouseci");
const REPORT_DIR = join(APP_DIR, "lighthouse-results");

const require = createRequire(import.meta.url);
/** The runs per URL, read from the config the assertions use, for the summary's heading. */
const RUNS: number = require("../lighthouserc.cjs").ci.collect.numberOfRuns;

/** The calibration's runs: enough for a median, few enough to cost about 30 s. */
const CALIBRATION_RUNS = 3;

const children: ChildProcess[] = [];

function run(command: string, args: string[], env: Record<string, string> = {}): number {
  const result = spawnSync(command, args, { cwd: APP_DIR, stdio: "inherit", env: { ...process.env, ...env } });
  return result.status ?? 1;
}

/** Starts a long-running server in its own process group, so stopping it stops what it spawned too. */
function startServer(command: string, args: string[], env: Record<string, string>): ChildProcess {
  const child = spawn(command, args, {
    cwd: APP_DIR,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...env },
    detached: true,
  });
  children.push(child);
  return child;
}

function stopServers(): void {
  for (const child of children.splice(0)) {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
}

async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Waits until `url` answers, failing at once if `server`, which should answer it, exits first. */
async function waitFor(url: string, server: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`The server for ${url} exited (${server.exitCode ?? server.signalCode}) before it answered; its output is above.`);
    }
    if (await answers(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s.`);
}

/** The raw runs `lhci collect` wrote. */
function rawRuns(): Lhr[] {
  return readdirSync(RAW_DIR)
    .filter((name) => /^lhr-.*\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(RAW_DIR, name), "utf8")) as Lhr);
}

/**
 * Measures the host's `benchmarkIndex` with a few performance-only runs of
 * `url` and returns the calibrated multiplier, or throws. The runs use the
 * gate's own config, so the same Chromium and flags, with the URL, the run
 * count and the categories overridden on the command line.
 */
function calibrate(url: string): Calibration {
  rmSync(RAW_DIR, { recursive: true, force: true });
  const status = run("pnpm", [
    "exec",
    "lhci",
    "collect",
    "--config=./lighthouserc.cjs",
    `--url=${url}`,
    `--numberOfRuns=${CALIBRATION_RUNS}`,
    "--settings.onlyCategories=performance",
  ]);
  if (status !== 0) throw new Error("The calibration's Lighthouse runs failed; their output is above.");
  const indexes = rawRuns()
    .map((lhr) => lhr.environment?.benchmarkIndex)
    .filter((value): value is number => typeof value === "number");
  rmSync(RAW_DIR, { recursive: true, force: true });
  const benchmarkIndex = median(indexes);
  if (benchmarkIndex === null || indexes.length !== CALIBRATION_RUNS) {
    throw new Error(`The calibration expected ${CALIBRATION_RUNS} benchmarkIndex values and read ${indexes.length}.`);
  }
  const multiplier = calibratedSlowdown(benchmarkIndex);
  console.log(`\nCalibration: benchmarkIndex ${indexes.map(Math.round).join(", ")}; median ${Math.round(benchmarkIndex)}, so a CPU slowdown of ${multiplier}x.\n`);
  return { benchmarkIndex, runs: CALIBRATION_RUNS, multiplier, formula: FORMULA, reference: REFERENCE_DEVICE };
}

async function main(): Promise<number> {
  const env = appServerEnv();
  const app = appSiteOrigin();
  const mock = mockCmsOrigin();

  for (const url of [`${mock}/__mock/health`, `${app}/`]) {
    if (await answers(url)) {
      throw new Error(`Something already answers at ${url}; stop it or choose other ports (RH_WEB_PORT, RH_MOCK_CMS_PORT).`);
    }
  }

  if (prebuilt()) {
    assertPrebuilt();
  } else {
    if (run("pnpm", ["exec", "next", "build"], env) !== 0) return 1;
    writeBuildStamp({ ...process.env, ...env });
  }
  if (run("node", ["e2e/clear-fetch-cache.mts"]) !== 0) return 1;

  const mockServer = startServer("node", ["e2e/mock-cms/main.mts"], { RH_MOCK_CMS_PORT: String(mockCmsPort()) });
  await waitFor(`${mock}/__mock/health`, mockServer, 15_000);
  const appServer = startServer("pnpm", ["exec", "next", "start", "--port", String(webPort())], env);
  await waitFor(`${app}/`, appServer, 60_000);

  // One request per URL renders each ISR listing and fills the Data Cache,
  // as a reader after the first would find it.
  const urls = SAMPLED_URLS.filter((sample) => sample.lighthouse).map((sample) => `${app}${sample.path}`);
  for (const url of urls) {
    const response = await fetch(url);
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`${url} answered ${response.status} while warming.`);
  }

  const started = Date.now();
  const calibration = calibrate(`${app}/`);
  const calibrated = Date.now();

  rmSync(RAW_DIR, { recursive: true, force: true });
  rmSync(REPORT_DIR, { recursive: true, force: true });
  const config = "--config=./lighthouserc.cjs";
  if (run("pnpm", ["exec", "lhci", "collect", config], { RH_LH_CPU_SLOWDOWN: String(calibration.multiplier) }) !== 0) return 1;
  const uploaded = run("pnpm", ["exec", "lhci", "upload", config]);
  const asserted = run("pnpm", ["exec", "lhci", "assert", config]);

  const runs = rawRuns();
  const table = medianTable(runs, RUNS, calibration);
  const seconds = (from: number, to: number) => Math.round((to - from) / 1000);
  console.log(`\n${table}\nCalibrated in ${seconds(started, calibrated)} s and collected in ${seconds(calibrated, Date.now())} s; reports in lighthouse-results/.`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);

  const uncalibrated = runs.filter((lhr) => lhr.configSettings?.throttling?.cpuSlowdownMultiplier !== calibration.multiplier);
  if (uncalibrated.length > 0) {
    console.error(`${uncalibrated.length} runs did not use the calibrated ${calibration.multiplier}x CPU slowdown, so their TBT is not comparable.`);
    return 1;
  }
  return asserted !== 0 ? asserted : uploaded;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopServers();
    process.exit(130);
  });
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  stopServers();
}
process.exit(code);
