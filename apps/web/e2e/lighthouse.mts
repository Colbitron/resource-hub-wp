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
 * cached page a reader gets rather than its first render, and runs
 * `lhci collect`, `lhci upload` (to `lighthouse-results/`) and `lhci assert`,
 * in that order, so the reports are written even when a budget fails. The
 * exit code is the assertion's. Both servers are stopped at the end.
 *
 * The medians are printed, and appended to `$GITHUB_STEP_SUMMARY` in CI.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createRequire } from "node:module";

import { assertPrebuilt, writeBuildStamp } from "./build-stamp.mts";
import { appServerEnv, appSiteOrigin, mockCmsOrigin, mockCmsPort, prebuilt, webPort } from "./mock-cms/config.mts";
import { SAMPLED_URLS } from "./sampled-urls.mts";

const APP_DIR = new URL("..", import.meta.url).pathname;
const RAW_DIR = join(APP_DIR, ".lighthouseci");
const REPORT_DIR = join(APP_DIR, "lighthouse-results");

const require = createRequire(import.meta.url);
/** The runs per URL, read from the config the assertions use, for the summary's heading. */
const RUNS: number = require("../lighthouserc.cjs").ci.collect.numberOfRuns;

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

interface Lhr {
  requestedUrl: string;
  categories: Record<string, { score: number | null }>;
  audits: Record<string, { numericValue?: number }>;
}

/** The median, or `null` when no run produced the number (an audit that errored in every run). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** A median for the table, or "n/a" when there is none. */
function cell(value: number | null, format: (value: number) => string): string {
  return value === null ? "n/a" : format(value);
}

/** The median of each budgeted number per URL, from the raw runs `lhci collect` wrote. */
function summary(): string {
  const runs = readdirSync(RAW_DIR)
    .filter((name) => /^lhr-.*\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(RAW_DIR, name), "utf8")) as Lhr);
  const byUrl = new Map<string, Lhr[]>();
  for (const lhr of runs) {
    byUrl.set(lhr.requestedUrl, [...(byUrl.get(lhr.requestedUrl) ?? []), lhr]);
  }
  const rows = [
    "| URL | Runs | Performance | Accessibility | LCP (ms) | CLS | TBT (ms) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [url, lhrs] of byUrl) {
    const pick = (read: (lhr: Lhr) => number | null | undefined) =>
      median(lhrs.map(read).filter((value): value is number => typeof value === "number"));
    const fixed = (digits: number) => (value: number) => value.toFixed(digits);
    const whole = (value: number) => String(Math.round(value));
    rows.push(
      `| ${new URL(url).pathname} | ${lhrs.length} | ${cell(pick((l) => l.categories.performance?.score), fixed(2))} | ${cell(pick((l) => l.categories.accessibility?.score), fixed(2))} | ${cell(pick((l) => l.audits["largest-contentful-paint"]?.numericValue), whole)} | ${cell(pick((l) => l.audits["cumulative-layout-shift"]?.numericValue), fixed(3))} | ${cell(pick((l) => l.audits["total-blocking-time"]?.numericValue), whole)} |`,
    );
  }
  return `### Lighthouse (mobile, median of ${RUNS})\n\n${rows.join("\n")}\n`;
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

  rmSync(RAW_DIR, { recursive: true, force: true });
  rmSync(REPORT_DIR, { recursive: true, force: true });
  const started = Date.now();
  const config = "--config=./lighthouserc.cjs";
  if (run("pnpm", ["exec", "lhci", "collect", config]) !== 0) return 1;
  const uploaded = run("pnpm", ["exec", "lhci", "upload", config]);
  const asserted = run("pnpm", ["exec", "lhci", "assert", config]);

  const table = summary();
  console.log(`\n${table}\nCollected in ${Math.round((Date.now() - started) / 1000)} s; reports in lighthouse-results/.`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);

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
