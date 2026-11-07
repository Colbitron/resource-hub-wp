/**
 * Runs the screenshot project (`*.screenshot.ts`) with Chromium inside
 * Playwright's official Linux Docker image, pinned by digest
 * (`playwright-image.mts`), so the baselines are the same pixels on a laptop
 * and in CI whatever the host's OS and fonts.
 *
 *   node e2e/screenshots.mts                      check against the baselines
 *   node e2e/screenshots.mts --update-snapshots   rewrite them
 *
 * Any other argument is passed to `playwright test`. The container
 * (`browser-container.mts`, which says how it is pinned, mounted and locked
 * down) runs only the browser server; the test runner, the mock CMS and the
 * app run on the host as in the normal suite (`playwright.config.ts`), and
 * the browser reaches the app through the connection.
 *
 * Before the runner starts, the same browser renders the brand images and
 * compares them with the committed files (`scripts/render-brand-images.mts`,
 * `checkBrandImages`); a stale one fails the run, in either mode, after the
 * runner has run, and is never rewritten here (`pnpm brand:images` does
 * that).
 *
 * With `RH_E2E_PREBUILT=1` the build in `.next` is checked first
 * (`build-stamp.mts`), before any container starts.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { checkBrandImages, connectToContainer, staleMessage } from "../scripts/render-brand-images.mts";
import { BrowserContainer } from "./browser-container.mts";
import { assertPrebuilt } from "./build-stamp.mts";
import { mockCmsPort, prebuilt, webPort } from "./mock-cms/config.mts";

const require = createRequire(import.meta.url);
/** The test runner's own entry point (`bin.playwright`), run with this Node rather than through `pnpm exec`. */
const TEST_CLI = join(dirname(require.resolve("@playwright/test/package.json")), "cli.js");
/** How long the test runner gets to stop its web servers after a signal before it is killed. */
const CHILD_EXIT_TIMEOUT_MS = 15_000;
/** The harness's two ports: the app's and the mock CMS's (`config.mts`). */
const HARNESS_PORTS = [webPort(), mockCmsPort()];
/** The exit status for each signal this script handles: 128 plus the signal's number. */
const SIGNAL_EXIT = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;

const container = new BrowserContainer();

let child: ChildProcess | undefined;
/**
 * The harness ports that were free when the runner started, so whatever
 * listens on them afterwards is this run's mock or app. A port that was
 * already taken (a server reused with `RH_E2E_REUSE=1`, or someone else's)
 * is never in this list and never touched.
 */
let ownedPorts: number[] = [];

/** The PIDs listening on a TCP port on this host, from `lsof`; empty when none, or when `lsof` is missing. */
function listeners(port: number): number[] {
  const result = spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  if (result.error) return [];
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => Number.parseInt(line, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function processGroup(pid: number): number | null {
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
  const pgid = Number.parseInt((result.stdout ?? "").trim(), 10);
  return Number.isInteger(pgid) && pgid > 0 ? pgid : null;
}

/** Sends SIGKILL to a process group, or to `pid` alone when the group is unknown; true when the target existed. */
function killGroup(pid: number): boolean {
  const ownGroup = processGroup(process.pid);
  const group = processGroup(pid);
  try {
    // Never this script's own group: only a listener started apart from it.
    if (group !== null && group !== ownGroup) process.kill(-group, "SIGKILL");
    else process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

/**
 * Playwright starts the mock and the app each in a process group of its own
 * (`launchProcess`), apart from the runner's, so killing the runner's group
 * does not stop them; Playwright stops them itself when it exits normally or
 * on SIGINT or SIGTERM, but not when it is killed. So after the runner has
 * gone, whatever still listens on a port that was free before it started is
 * killed, with its process group, as Playwright would have. Synchronous, so
 * it also runs from the `exit` handler.
 */
function freeOwnedPorts(): void {
  for (const port of ownedPorts) {
    const pids = listeners(port);
    if (pids.length === 0) continue;
    console.error(`Port ${port} was still listening after the test runner exited; stopping PID ${pids.join(", ")}.`);
    for (const pid of pids) killGroup(pid);
  }
  ownedPorts = [];
}

/** Kills the runner's process group if the runner is still alive. */
function killRunner(): void {
  const running = child;
  if (running?.pid === undefined || running.exitCode !== null || running.signalCode !== null) return;
  try {
    process.kill(-running.pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** Everything this script started, stopped in order: the runner, its web servers, the container. Idempotent. */
function cleanUp(): void {
  killRunner();
  freeOwnedPorts();
  container.stop();
}

/** Resolves when `subprocess` has exited, or after `timeoutMs`; true when it exited. */
function exited(subprocess: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (subprocess.exitCode !== null || subprocess.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    subprocess.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * The committed brand PNGs against a fresh render in the same container
 * (`scripts/render-brand-images.mts`, `--check`), so a change to the mark,
 * the tokens or the words that was not followed by `pnpm brand:images`
 * fails this gate. True when every file matches.
 */
async function brandImagesMatch(endpoint: string): Promise<boolean> {
  console.log("Checking the committed brand images against a fresh render.");
  const browser = await connectToContainer(endpoint);
  try {
    const problems = await checkBrandImages(browser);
    if (problems.length === 0) return true;
    console.error(staleMessage(problems));
    return false;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<number> {
  if (prebuilt()) assertPrebuilt();
  container.start();
  const endpoint = await container.endpoint();

  // Before the runner, which needs neither the app nor the mock; its result
  // is repeated at the end so it is not lost above the runner's output.
  let brandMatch = false;
  try {
    brandMatch = await brandImagesMatch(endpoint);
  } catch (error) {
    console.error(`The brand images could not be checked: ${error instanceof Error ? error.message : String(error)}`);
  }

  // The runner in a process group of its own (`detached`), so a Ctrl-C in a
  // terminal reaches this script alone and the runner gets the signal once,
  // from the handler below, rather than twice (a second SIGINT makes
  // Playwright exit without stopping its web servers).
  ownedPorts = HARNESS_PORTS.filter((port) => listeners(port).length === 0);
  child = spawn(process.execPath, [TEST_CLI, "test", "--project=screenshots", ...process.argv.slice(2)], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, RH_PW_REMOTE_WS: endpoint },
    detached: true,
  });
  const running = child;
  const code = await new Promise<number>((resolve) => running.on("exit", (status) => resolve(status ?? 1)));
  if (!brandMatch) {
    console.error("The brand image check failed (above), so this run fails whatever the screenshots did.");
    return code === 0 ? 1 : code;
  }
  return code;
}

let stopping = false;
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    // Playwright stops its web servers (the mock and the app) on SIGINT and
    // SIGTERM; a hang-up is passed on as SIGTERM. Wait for it to finish, and
    // kill its group only if it does not exit in time. The web servers are
    // in groups of their own, so whichever way the runner ends, cleanUp()
    // then stops anything still listening on the ports this run took, and
    // only then the container.
    const running = child;
    if (running?.pid !== undefined && running.exitCode === null && running.signalCode === null) {
      running.kill(signal === "SIGHUP" ? "SIGTERM" : signal);
      await exited(running, CHILD_EXIT_TIMEOUT_MS);
    }
    cleanUp();
    process.exit(SIGNAL_EXIT[signal]);
  });
}
// The last resort, for an exit no handler above saw (an uncaught error):
// the same synchronous cleanup, which does nothing when it already ran.
process.on("exit", cleanUp);

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  // After a signal the handler above finishes the shutdown and exits.
  if (!stopping) cleanUp();
}
if (!stopping) process.exit(code);
