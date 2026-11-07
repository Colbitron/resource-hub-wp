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
 * CPU slowdown: three quick Lighthouse runs (performance only) of the
 * calibration page, a frozen copy of the built `/` served from its own small
 * server on a port the system chooses (`calibration-page.mts`), measure the
 * host's raw main-thread time on it, and their median W sets the multiplier,
 * `REFERENCE_MS / W` (`cpu-calibration.mts`, which stops the run on a host
 * outside its bounds). A snapshot that no longer has every file its page
 * requests stops the run too. The calibration costs about 30 s; its reports
 * are discarded. Then it runs
 * `lhci collect` with that multiplier, `lhci upload` (to
 * `lighthouse-results/`) and `lhci assert`, in that order, so the reports are
 * written even when a budget fails, and checks that every run used the
 * calibrated multiplier. The exit code is the assertion's. Both servers are
 * stopped at the end.
 *
 * The medians, with each URL's raw main-thread time, `benchmarkIndex` and
 * multiplier and the calibration's W, formula and reference device, are
 * printed, and appended to `$GITHUB_STEP_SUMMARY` in CI. The index is
 * reported only; it does not set the multiplier.
 */

import { appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createRequire } from "node:module";

import { startCalibrationServer } from "./calibration-page.mts";
import { calibratedSlowdown, FORMULA, multiplierFor, REFERENCE_DEVICE, REFERENCE_MS } from "./cpu-calibration.mts";
import { APP_DIR, performanceRuns, prepareApp, RAW_DIR, rawRuns, run, startServers, stopServers } from "./lab.mts";
import { median, medianTable, rawTaskTime, type Calibration } from "./lighthouse-summary.mts";
import { appSiteOrigin } from "./mock-cms/config.mts";
import { SAMPLED_URLS } from "./sampled-urls.mts";

const REPORT_DIR = join(APP_DIR, "lighthouse-results");

const require = createRequire(import.meta.url);
/** The runs per URL, read from the config the assertions use, for the summary's heading. */
const RUNS: number = require("../lighthouserc.cjs").ci.collect.numberOfRuns;

/** The calibration's runs: enough for a median, few enough to cost about 30 s. */
const CALIBRATION_RUNS = 3;

/**
 * Measures this host's raw main-thread time on the calibration page with a
 * few performance-only runs and returns the calibrated multiplier, or
 * throws: on a host outside the bounds, on a run without the number, and on
 * a snapshot missing a file its page requested.
 */
async function calibrate(): Promise<Calibration> {
  const server = await startCalibrationServer();
  let lhrs;
  try {
    lhrs = await performanceRuns(server.url, CALIBRATION_RUNS);
  } finally {
    await server.close();
  }
  if (server.missing.length > 0) {
    throw new Error(
      `The calibration page requested files its snapshot lacks (${server.missing.join(", ")}); regenerate it (e2e/README.md, "Lighthouse CI").`,
    );
  }
  const times = lhrs.map(rawTaskTime).filter((value): value is number => value !== null);
  const workMs = median(times);
  if (workMs === null || times.length !== CALIBRATION_RUNS) {
    throw new Error(`The calibration expected ${CALIBRATION_RUNS} raw main-thread times and read ${times.length}.`);
  }
  const indexes = lhrs.map((lhr) => lhr.environment?.benchmarkIndex).filter((value): value is number => typeof value === "number");
  const benchmarkIndex = median(indexes);
  const multiplier = calibratedSlowdown(workMs);
  const calculator = benchmarkIndex === null ? null : multiplierFor(benchmarkIndex);
  console.log(
    `\nCalibration: raw main-thread time ${times.map(Math.round).join(", ")} ms; median W = ${Math.round(workMs)} ms, so a CPU slowdown of ${REFERENCE_MS} / ${Math.round(workMs)} = ${multiplier}x. ` +
      `benchmarkIndex ${indexes.map(Math.round).join(", ")} (median ${benchmarkIndex === null ? "n/a" : Math.round(benchmarkIndex)}; the calculator would give ${calculator === null ? "none" : `${calculator.toFixed(1)}x`}), for information only.\n`,
  );
  return { workMs, runs: CALIBRATION_RUNS, referenceMs: REFERENCE_MS, multiplier, benchmarkIndex, formula: FORMULA, reference: REFERENCE_DEVICE };
}

async function main(): Promise<number> {
  if (!(await prepareApp())) return 1;
  await startServers();
  const app = appSiteOrigin();

  // One request per URL renders each ISR listing and fills the Data Cache,
  // as a reader after the first would find it.
  const urls = SAMPLED_URLS.filter((sample) => sample.lighthouse).map((sample) => `${app}${sample.path}`);
  for (const url of urls) {
    const response = await fetch(url);
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`${url} answered ${response.status} while warming.`);
  }

  const started = Date.now();
  const calibration = await calibrate();
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
