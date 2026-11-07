/**
 * What the lab runners (`lighthouse.mts`, `write-calibration-page.mts`)
 * share: building the app under test once, starting the mock CMS and
 * `next start` on the harness's ports and stopping them again, and
 * Lighthouse's raw runs.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertPrebuilt, writeBuildStamp } from "./build-stamp.mts";
import type { Lhr } from "./lighthouse-summary.mts";
import { appServerEnv, appSiteOrigin, mockCmsOrigin, mockCmsPort, prebuilt, webPort } from "./mock-cms/config.mts";

export const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
/** Where `lhci collect` writes its raw runs. */
export const RAW_DIR = join(APP_DIR, ".lighthouseci");

const children: ChildProcess[] = [];

/** Runs a command in the app's directory to completion, its output inherited, and returns its exit code. */
export function run(command: string, args: string[], env: Record<string, string> = {}): number {
  const result = spawnSync(command, args, { cwd: APP_DIR, stdio: "inherit", env: { ...process.env, ...env } });
  return result.status ?? 1;
}

/**
 * `run` without blocking the event loop, for a command that requests a
 * server this process itself serves (`calibration-page.mts`), which a
 * synchronous spawn would leave unanswered.
 */
export function runAsync(command: string, args: string[], env: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: APP_DIR, stdio: "inherit", env: { ...process.env, ...env } });
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
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

/** Sends SIGTERM to the process group of every server `startServers` started. */
export function stopServers(): void {
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

/**
 * Builds the app with the test environment and stamps the build, or, with
 * `RH_E2E_PREBUILT=1`, checks that the build in `.next` is already that one
 * (`build-stamp.mts`); then clears the fetch cache. Refuses ports something
 * already answers on, before building. Returns false when a step failed,
 * its output above.
 */
export async function prepareApp(): Promise<boolean> {
  for (const url of [`${mockCmsOrigin()}/__mock/health`, `${appSiteOrigin()}/`]) {
    if (await answers(url)) {
      throw new Error(`Something already answers at ${url}; stop it or choose other ports (RH_WEB_PORT, RH_MOCK_CMS_PORT).`);
    }
  }
  const env = appServerEnv();
  if (prebuilt()) {
    assertPrebuilt();
  } else {
    if (run("pnpm", ["exec", "next", "build"], env) !== 0) return false;
    writeBuildStamp({ ...process.env, ...env });
  }
  return run("node", ["e2e/clear-fetch-cache.mts"]) === 0;
}

/** Starts the mock CMS and `next start` on the harness's ports and waits until both answer. */
export async function startServers(): Promise<void> {
  const mockServer = startServer("node", ["e2e/mock-cms/main.mts"], { RH_MOCK_CMS_PORT: String(mockCmsPort()) });
  await waitFor(`${mockCmsOrigin()}/__mock/health`, mockServer, 15_000);
  const appServer = startServer("pnpm", ["exec", "next", "start", "--port", String(webPort())], appServerEnv());
  await waitFor(`${appSiteOrigin()}/`, appServer, 60_000);
}

/** The raw runs `lhci collect` wrote. */
export function rawRuns(): Lhr[] {
  return readdirSync(RAW_DIR)
    .filter((name) => /^lhr-.*\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(RAW_DIR, name), "utf8")) as Lhr);
}

/**
 * Runs Lighthouse `runs` times on `url`, performance only, and returns the
 * results, or throws. The runs use the gate's own config, so the same
 * Chromium and flags, with the URL, the run count and the categories
 * overridden on the command line. The raw runs are deleted before and after.
 */
export async function performanceRuns(url: string, runs: number): Promise<Lhr[]> {
  rmSync(RAW_DIR, { recursive: true, force: true });
  const status = await runAsync("pnpm", [
    "exec",
    "lhci",
    "collect",
    "--config=./lighthouserc.cjs",
    `--url=${url}`,
    `--numberOfRuns=${runs}`,
    "--settings.onlyCategories=performance",
  ]);
  if (status !== 0) throw new Error(`The performance-only Lighthouse runs of ${url} failed; their output is above.`);
  const lhrs = rawRuns();
  rmSync(RAW_DIR, { recursive: true, force: true });
  return lhrs;
}
