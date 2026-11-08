/**
 * Runs Lighthouse CI (`lighthouserc.cjs`) against the built app and the mock
 * CMS, the same two servers the Playwright suite starts, and prints the
 * median of each budgeted number per URL.
 *
 *   node e2e/lighthouse.mts
 *
 * Starts the mock first, then builds the app with the test environment
 * (`appServerEnv`) and stamps the build (`build-stamp.mts`), unless
 * `RH_E2E_PREBUILT=1` says the build in `.next` is already that one, as in
 * CI after the end-to-end run; then the stamp must say so, or the run stops
 * before starting anything. The mock is up before the build because the
 * build prerenders the library, the type listings, the root and the newest
 * resources from the CMS it can reach (ADR 0043; `lib/prerender.ts`), and
 * Lighthouse should measure the same build the end-to-end run tests. Then it
 * clears the fetch cache, starts `next start` on the harness's port (refusing
 * a port something already answers on, and failing at once if either server
 * exits while it waits), requests each URL once so Lighthouse measures the
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
import { medianTable, type Lhr } from "./lighthouse-summary.mts";

const APP_DIR = new URL("..", import.meta.url).pathname;
const RAW_DIR = join(APP_DIR, ".lighthouseci");
const REPORT_DIR = join(APP_DIR, "lighthouse-results");

const require = createRequire(import.meta.url);
const COLLECT: { numberOfRuns: number; url: string[] } = require("../lighthouserc.cjs").ci.collect;
/** The runs per URL, read from the config the assertions use, for the summary's heading. */
const RUNS = COLLECT.numberOfRuns;
/**
 * The URLs `lhci collect` measures, read from the config too, so the warm-up
 * requests the same list, one shard of it when `RH_LIGHTHOUSE_SHARD` names
 * one (`lighthouse-shard.mts`).
 */
const URLS = COLLECT.url;

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

/** The median of each budgeted number per URL, from the raw runs `lhci collect` wrote. */
function summary(): string {
  const runs = readdirSync(RAW_DIR)
    .filter((name) => /^lhr-.*\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(RAW_DIR, name), "utf8")) as Lhr);
  return medianTable(runs, RUNS);
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

  const mockServer = startServer("node", ["e2e/mock-cms/main.mts"], { RH_MOCK_CMS_PORT: String(mockCmsPort()) });
  await waitFor(`${mock}/__mock/health`, mockServer, 15_000);

  if (prebuilt()) {
    assertPrebuilt();
  } else {
    if (run("pnpm", ["build"], env) !== 0) return 1;
    writeBuildStamp({ ...process.env, ...env });
  }
  if (run("node", ["scripts/clear-fetch-cache.mts"]) !== 0) return 1;

  const appServer = startServer("pnpm", ["exec", "next", "start", "--port", String(webPort())], env);
  await waitFor(`${app}/`, appServer, 60_000);

  // One request per URL renders each ISR listing and fills the Data Cache,
  // as a reader after the first would find it.
  for (const url of URLS) {
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
