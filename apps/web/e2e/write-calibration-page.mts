/**
 * Regenerates `calibration-page/`, the frozen page the Lighthouse gate
 * calibrates its CPU slowdown on (`calibration-page.mts`,
 * `cpu-calibration.mts`), from this checkout's own build, then measures it on
 * this host and prints the `DERIVATION` that goes with it.
 *
 *   pnpm --filter resource-hub-web lighthouse:calibration-page
 *
 * It builds the app as the gate does (or, with `RH_E2E_PREBUILT=1`, checks
 * the build is the gate's), starts the mock and `next start` on the
 * harness's ports, and takes `/` as a reader gets it: the second response,
 * from the cache the first filled. It stops both servers, loads that HTML
 * once in Playwright's Chromium at Lighthouse's mobile viewport, serving
 * `/_next/static/` from `.next/static/`, and keeps exactly the files the
 * page requested; the rest, such as the share image the HTML only names,
 * are left out. Then it replaces the folder with the HTML and those files.
 *
 * Last, it loads the new snapshot nine times in Lighthouse, performance
 * only, and prints the median `benchmarkIndex` and raw main-thread time and
 * the `REFERENCE_MS` they give. The snapshot and the constant are one
 * calibration: commit the folder and the printed `DERIVATION` together, in
 * the same commit. Run it on the host the derivation names, or one of its
 * class (an Apple-silicon laptop, where Lighthouse's own calculator is
 * trusted), and say which in the record.
 */

import { cpSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { chromium } from "@playwright/test";

import { CALIBRATION_DIR, startCalibrationServer } from "./calibration-page.mts";
import { multiplierFor } from "./cpu-calibration.mts";
import { APP_DIR, performanceRuns, prepareApp, startServers, stopServers } from "./lab.mts";
import { median, rawTaskTime } from "./lighthouse-summary.mts";
import { appSiteOrigin } from "./mock-cms/config.mts";

/** The measurement's runs: more than the gate's three, as the constant is fixed once. */
const MEASURE_RUNS = 9;

async function capture(): Promise<string> {
  await startServers();
  try {
    let html = "";
    for (let request = 0; request < 2; request += 1) {
      const response = await fetch(`${appSiteOrigin()}/`);
      html = await response.text();
      if (!response.ok) throw new Error(`/ answered ${response.status}.`);
    }
    return html;
  } finally {
    stopServers();
  }
}

/** The `/_next/static/` paths the page requests when loaded once at Lighthouse's mobile viewport. */
async function loadedFiles(html: string): Promise<string[]> {
  const recorder = await startCalibrationServer({ html, staticDir: join(APP_DIR, ".next", "static") });
  const browser = await chromium.launch({ executablePath: chromium.executablePath() });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true });
    await page.goto(recorder.url, { waitUntil: "networkidle" });
  } finally {
    await browser.close();
    await recorder.close();
  }
  if (recorder.missing.length > 0) {
    throw new Error(`The page requested files the build does not have: ${recorder.missing.join(", ")}.`);
  }
  return recorder.served;
}

function write(html: string, files: readonly string[]): number {
  rmSync(CALIBRATION_DIR, { recursive: true, force: true });
  mkdirSync(CALIBRATION_DIR, { recursive: true });
  writeFileSync(join(CALIBRATION_DIR, "index.html"), html);
  let bytes = Buffer.byteLength(html);
  for (const path of files) {
    const relative = path.slice("/_next/static/".length);
    const target = join(CALIBRATION_DIR, "_next", "static", relative);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(APP_DIR, ".next", "static", relative), target);
    bytes += statSync(target).size;
  }
  return bytes;
}

async function measure(): Promise<void> {
  const server = await startCalibrationServer();
  let lhrs;
  try {
    lhrs = await performanceRuns(server.url, MEASURE_RUNS);
  } finally {
    await server.close();
  }
  if (server.missing.length > 0) throw new Error(`Lighthouse requested files the snapshot lacks: ${server.missing.join(", ")}.`);
  const raw = lhrs.map(rawTaskTime).filter((value): value is number => value !== null);
  const indexes = lhrs.map((lhr) => lhr.environment?.benchmarkIndex).filter((value): value is number => typeof value === "number");
  const rawMedian = median(raw);
  const indexMedian = median(indexes);
  if (rawMedian === null || indexMedian === null || raw.length !== MEASURE_RUNS || indexes.length !== MEASURE_RUNS) {
    throw new Error(`Expected ${MEASURE_RUNS} raw times and indexes; read ${raw.length} and ${indexes.length}.`);
  }
  // Rounded as DERIVATION records them, so the constant printed is the one the module computes.
  const benchmarkIndex = Math.round(indexMedian);
  const rawMs = Math.round(rawMedian * 10) / 10;
  const factor = multiplierFor(benchmarkIndex);
  if (factor === null) throw new Error(`This host's benchmarkIndex, ${benchmarkIndex}, is below the calculator's floor of 150.`);
  console.log(
    `\nOn this host: benchmarkIndex ${indexes.map(Math.round).join(", ")} (median ${benchmarkIndex}, which the calculator puts at ${factor.toFixed(2)}x); ` +
      `raw main-thread time ${raw.map((value) => value.toFixed(1)).join(", ")} ms (median ${rawMs} ms).\n` +
      `So REFERENCE_MS = ${factor.toFixed(2)} × ${rawMs} = ${Math.round(factor * rawMs)} ms. ` +
      `Commit, with the folder: DERIVATION = { benchmarkIndex: ${benchmarkIndex}, rawMs: ${rawMs}, … } in cpu-calibration.mts.\n`,
  );
}

async function main(): Promise<number> {
  if (!(await prepareApp())) return 1;
  const html = await capture();
  const files = await loadedFiles(html);
  const bytes = write(html, files);
  console.log(`\nWrote ${CALIBRATION_DIR}: index.html and ${files.length} static files, ${Math.round(bytes / 1024)} KB.`);
  await measure();
  return 0;
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
