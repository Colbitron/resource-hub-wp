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
 * (`playwright.config.ts`), and the browser reaches the app's `localhost`
 * through the connection.
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
import { dirname } from "node:path";

import { assertPrebuilt } from "./build-stamp.mts";
import { prebuilt } from "./mock-cms/config.mts";
import { PLAYWRIGHT_IMAGE, PLAYWRIGHT_IMAGE_VERSION } from "./playwright-image.mts";

const require = createRequire(import.meta.url);
/** The `playwright-core` the test runner uses, resolved through `@playwright/test` as the runner resolves it. */
const CORE_DIR = realpathSync(
  dirname(require.resolve("playwright-core/package.json", { paths: [dirname(require.resolve("@playwright/test/package.json"))] })),
);
const CORE_VERSION: string = require(`${CORE_DIR}/package.json`).version;
const CORE_MOUNT = "/opt/playwright-core";
const PLATFORM = process.env.RH_PW_DOCKER_PLATFORM || "linux/amd64";
const CONTAINER = `rh-playwright-${randomBytes(4).toString("hex")}`;
/**
 * The server's endpoint path, known only to this process. The server must
 * run with `--unsafe` (below), which lets any client that reaches it launch
 * Chromium with arguments of its choosing; the port is published on the
 * host's loopback only, and the random path keeps another local process that
 * finds the port from using it.
 */
const ENDPOINT_PATH = `/${randomBytes(16).toString("hex")}`;
/** Starting Chromium's server under emulation can take a while on a cold machine. */
const START_TIMEOUT_MS = 120_000;

function docker(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
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
      throw new Error(`The browser container stopped before it was ready:\n${logs.stdout}${logs.stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The browser server did not start within ${START_TIMEOUT_MS / 1000} s.`);
}

async function main(): Promise<number> {
  if (CORE_VERSION !== PLAYWRIGHT_IMAGE_VERSION) {
    throw new Error(
      `The installed playwright-core is ${CORE_VERSION}, but the screenshot image is pinned to ${PLAYWRIGHT_IMAGE_VERSION}; update e2e/playwright-image.mts as its comment says.`,
    );
  }
  if (prebuilt()) assertPrebuilt();

  const run = docker([
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
    // Chromium needs more shared memory than Docker's 64 MB default; a
    // container-sized /dev/shm rather than the host's IPC namespace.
    "--shm-size=1g",
    "--volume",
    `${CORE_DIR}:${CORE_MOUNT}:ro`,
    PLAYWRIGHT_IMAGE,
    "node",
    `${CORE_MOUNT}/cli.js`,
    "run-server",
    "--port",
    "3000",
    "--host",
    "0.0.0.0",
    "--path",
    ENDPOINT_PATH,
    // --unsafe lets the client pass Chromium arguments: the screenshots
    // project's `--no-zygote` (playwright.config.ts), without which the
    // renderers crash under QEMU. There is no other way to give a run-server
    // browser an argument: the server takes none of its own, and
    // `launch-server`, which takes launch options from a file, serves a
    // pre-launched browser without the network proxy `exposeNetwork` needs
    // to reach the host's `localhost` (playwright-core 1.64.1). Hence the
    // loopback-only port and the random ENDPOINT_PATH above.
    "--unsafe",
  ]);
  if (run.status !== 0) {
    process.stderr.write(run.stderr);
    return 1;
  }
  started = true;
  console.log(`Started ${CONTAINER} from ${PLAYWRIGHT_IMAGE} (${PLATFORM}), serving playwright-core ${CORE_VERSION}.`);

  const endpoint = await waitForServer();
  console.log("Browser server ready.");

  child = spawn("pnpm", ["exec", "playwright", "test", "--project=screenshots", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, RH_PW_REMOTE_WS: endpoint },
  });
  const running = child;
  return await new Promise<number>((resolve) => running.on("exit", (code) => resolve(code ?? 1)));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Playwright stops its web servers (the mock and the app) when it is
    // signalled, so pass the signal on rather than leaving it orphaned.
    if (child !== undefined && child.exitCode === null) child.kill(signal);
    stopContainer();
    process.exit(130);
  });
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  stopContainer();
}
process.exit(code);
