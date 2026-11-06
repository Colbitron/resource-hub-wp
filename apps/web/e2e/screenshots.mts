/**
 * Runs the screenshot project (`*.screenshot.ts`) with Chromium inside
 * Playwright's official Linux Docker image, pinned by digest
 * (`playwright-image.mts`), so the baselines are the same pixels on a laptop
 * and in CI whatever the host's OS and fonts.
 *
 *   node e2e/screenshots.mts                      check against the baselines
 *   node e2e/screenshots.mts --update-snapshots   rewrite them
 *
 * Any other argument is passed to `playwright test`. The container runs only
 * the browser server (`playwright run-server`); the test runner, the mock CMS
 * and the app run on the host as in the normal suite
 * (`playwright.config.ts`), and the browser reaches the app through the
 * connection.
 *
 * The server is the repository's own installed `playwright-core`, mounted
 * read-only into the container, rather than a package fetched from npm on
 * each run: nothing is downloaded but the pinned image, and the server is
 * the same version as the client by construction. The script refuses to
 * start when that version and the image's differ.
 *
 * The image is pinned to linux/amd64, the platform of GitHub's runners, so an
 * Apple-silicon laptop renders under emulation the same pixels CI does.
 * `RH_PW_DOCKER_PLATFORM` overrides it. The container gets a name of its own
 * and a free host port from Docker, and only that container is stopped at
 * the end; nothing else running in Docker is touched.
 *
 * With `RH_E2E_PREBUILT=1` the build in `.next` is checked first
 * (`build-stamp.mts`), before any container starts.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { assertPrebuilt } from "./build-stamp.mts";
import { prebuilt } from "./mock-cms/config.mts";
import { PLAYWRIGHT_IMAGE, PLAYWRIGHT_IMAGE_VERSION } from "./playwright-image.mts";

const require = createRequire(import.meta.url);
const TEST_DIR = dirname(require.resolve("@playwright/test/package.json"));
/** The test runner's own entry point (`bin.playwright`), run with this Node rather than through `pnpm exec`. */
const TEST_CLI = join(TEST_DIR, "cli.js");
/** The `playwright-core` the test runner uses, resolved through `@playwright/test` as the runner resolves it. */
const CORE_DIR = realpathSync(dirname(require.resolve("playwright-core/package.json", { paths: [TEST_DIR] })));
const CORE_VERSION: string = require(`${CORE_DIR}/package.json`).version;
const CORE_MOUNT = "/opt/playwright-core";
const PLATFORM = process.env.RH_PW_DOCKER_PLATFORM || "linux/amd64";
const CONTAINER = `rh-playwright-${randomBytes(4).toString("hex")}`;
/**
 * The server's endpoint path: random, so unguessable, but not a secret.
 * The server must run with `--unsafe` (below), which lets any client that
 * reaches it launch Chromium with arguments of its choosing; the port is
 * published on the host's loopback only, and the path keeps a local process
 * that merely finds the port from using it.
 *
 * It is not in this script's `docker` command line: Docker takes it from the
 * environment (`--env RH_PW_PATH` with no value inherits it) and the
 * container's shell expands it. This script never prints it: Docker's
 * errors and the container's log are redacted before they are shown. It can
 * still be read from this script's environment or the test runner's
 * (`RH_PW_REMOTE_WS`), which needs this user's rights; from `docker inspect`,
 * which needs Docker's, a superset of the browser's; and, on a Linux host,
 * where container processes show in the host's `ps`, from the server's own
 * arguments, since `run-server` reads the path from nowhere else. A local
 * user who reads it there can use the server while the run lasts, which is
 * why the container is locked down below and lives only for the run; CI's
 * runners are single-tenant VMs.
 */
const ENDPOINT_PATH = `/${randomBytes(16).toString("hex")}`;
const PATH_VARIABLE = "RH_PW_PATH";
/** Starting Chromium's server under emulation can take a while on a cold machine. */
const START_TIMEOUT_MS = 120_000;
/** How long the test runner gets to stop its web servers after a signal before it is killed. */
const CHILD_EXIT_TIMEOUT_MS = 15_000;

function docker(args: string[], env: NodeJS.ProcessEnv = process.env): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("docker", args, { encoding: "utf8", env });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Text from the container with the endpoint path replaced, so nothing this script prints carries it. */
function redact(text: string): string {
  return text.split(ENDPOINT_PATH).join("/<endpoint path>");
}

let started = false;
let child: ChildProcess | undefined;

function stopContainer(): void {
  if (!started) return;
  started = false;
  // Started with --rm, so stopping it removes it too.
  docker(["stop", "--time", "5", CONTAINER]);
}

async function waitForServer(): Promise<string> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const logs = docker(["logs", CONTAINER]);
    if (/Listening on ws:\/\//.test(logs.stdout + logs.stderr)) {
      const port = docker(["port", CONTAINER, "3000/tcp"]).stdout.trim().split("\n")[0];
      const match = /:(\d+)$/.exec(port ?? "");
      if (!match) throw new Error(`Could not read the browser server's port from "${port}".`);
      return `ws://127.0.0.1:${match[1]}${ENDPOINT_PATH}`;
    }
    const state = docker(["inspect", "--format", "{{.State.Running}}", CONTAINER]);
    if (state.stdout.trim() !== "true") {
      throw new Error(`The browser container stopped before it was ready:\n${redact(logs.stdout + logs.stderr)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The browser server did not start within ${START_TIMEOUT_MS / 1000} s.`);
}

/** Resolves when `process` has exited, or after `timeoutMs`; true when it exited. */
function exited(process: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    process.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function main(): Promise<number> {
  if (CORE_VERSION !== PLAYWRIGHT_IMAGE_VERSION) {
    throw new Error(
      `The installed playwright-core is ${CORE_VERSION}, but the screenshot image is pinned to ${PLAYWRIGHT_IMAGE_VERSION}; update e2e/playwright-image.mts as its comment says.`,
    );
  }
  if (prebuilt()) assertPrebuilt();

  const run = docker(
    [
      "run",
      "--detach",
      "--rm",
      "--init",
      "--name",
      CONTAINER,
      "--platform",
      PLATFORM,
      "--publish",
      "127.0.0.1::3000",
      "--user",
      "pwuser",
      "--workdir",
      "/home/pwuser",
      // Least privilege. Playwright launches Chromium without its own sandbox
      // (`chromiumSandbox` is false by default), so Chromium needs no
      // capability and no setuid helper: every capability is dropped and no
      // process can gain privileges. Each flag was checked with a full run
      // under amd64 emulation on Apple silicon.
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges",
      // Bounds on what a runaway browser can take from the host. Chromium's
      // threads count against the PID limit; one page in one browser uses
      // a few hundred under emulation.
      "--pids-limit",
      "1024",
      "--memory",
      "3g",
      // Chromium needs more shared memory than Docker's 64 MB default; a
      // container-sized /dev/shm rather than the host's IPC namespace.
      "--shm-size=1g",
      "--mount",
      `type=bind,source=${CORE_DIR},target=${CORE_MOUNT},readonly`,
      // The endpoint path, from this script's environment (below), never
      // from the command line.
      "--env",
      PATH_VARIABLE,
      PLAYWRIGHT_IMAGE,
      "sh",
      "-c",
      // --unsafe lets the client pass Chromium arguments: the screenshots
      // project's `--no-zygote` (playwright.config.ts), without which the
      // renderers crash under QEMU. There is no other way to give a
      // run-server browser an argument: the server takes none of its own,
      // and `launch-server`, which takes launch options from a file, serves a
      // pre-launched browser without the network proxy `exposeNetwork` needs
      // to reach the host's app (playwright-core 1.64.1). Hence the
      // loopback-only port, the random endpoint path and the dropped
      // privileges above.
      `exec node ${CORE_MOUNT}/cli.js run-server --port 3000 --host 0.0.0.0 --path "$${PATH_VARIABLE}" --unsafe`,
    ],
    { ...process.env, [PATH_VARIABLE]: ENDPOINT_PATH },
  );
  if (run.status !== 0) {
    process.stderr.write(redact(run.stderr));
    return 1;
  }
  started = true;
  console.log(`Started ${CONTAINER} from ${PLAYWRIGHT_IMAGE} (${PLATFORM}), serving playwright-core ${CORE_VERSION}.`);

  const endpoint = await waitForServer();
  console.log("Browser server ready.");

  // The runner in a process group of its own (`detached`), so a Ctrl-C in a
  // terminal reaches this script alone and the runner gets the signal once,
  // from the handler below, rather than twice (a second SIGINT makes
  // Playwright exit without stopping its web servers).
  child = spawn(process.execPath, [TEST_CLI, "test", "--project=screenshots", ...process.argv.slice(2)], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, RH_PW_REMOTE_WS: endpoint },
    detached: true,
  });
  const running = child;
  return await new Promise<number>((resolve) => running.on("exit", (code) => resolve(code ?? 1)));
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    // Playwright stops its web servers (the mock and the app) when it is
    // signalled; wait for it to finish doing so, so neither outlives this
    // script, and kill its whole group only if it does not exit in time.
    const running = child;
    if (running?.pid !== undefined && running.exitCode === null && running.signalCode === null) {
      running.kill(signal);
      if (!(await exited(running, CHILD_EXIT_TIMEOUT_MS))) {
        try {
          process.kill(-running.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    stopContainer();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  // After a signal the handler above finishes the shutdown and exits.
  if (!stopping) stopContainer();
}
if (!stopping) process.exit(code);
