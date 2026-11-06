/**
 * Runs the screenshot project (`*.screenshot.ts`) with Chromium inside
 * Playwright's official Linux Docker image, at the exact version of
 * `@playwright/test` installed here, so the baselines are the same pixels on
 * a laptop and in CI whatever the host's OS and fonts.
 *
 *   node e2e/screenshots.mts                      check against the baselines
 *   node e2e/screenshots.mts --update-snapshots   rewrite them
 *
 * Any other argument is passed to `playwright test`. The container runs only
 * the browser (`playwright run-server`); the test runner, the mock CMS and
 * the app run on the host as in the normal suite (`playwright.config.ts`),
 * and the browser reaches the app's `localhost` through the connection.
 *
 * The image is pinned to linux/amd64, the platform of GitHub's runners, so an
 * Apple-silicon laptop renders under emulation the same pixels CI does.
 * `RH_PW_DOCKER_PLATFORM` overrides it. The container gets a name of its own
 * and a free host port from Docker, and only that container is stopped at
 * the end; nothing else running in Docker is touched.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const VERSION: string = require("@playwright/test/package.json").version;
const IMAGE = `mcr.microsoft.com/playwright:v${VERSION}-noble`;
const PLATFORM = process.env.RH_PW_DOCKER_PLATFORM || "linux/amd64";
const CONTAINER = `rh-playwright-${randomBytes(4).toString("hex")}`;
/** The server downloads the matching `playwright` package on first start, which takes a while under emulation. */
const START_TIMEOUT_MS = 300_000;

function docker(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

let started = false;

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
      return `ws://127.0.0.1:${match[1]}/`;
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
    // Chromium needs more shared memory than Docker's 64 MB default.
    "--ipc",
    "host",
    IMAGE,
    "/bin/sh",
    "-c",
    // --unsafe lets the client pass Chromium arguments (the screenshots
    // project's `--no-zygote`, playwright.config.ts). The port is published
    // on the host's loopback only, so nothing else can reach the server.
    `npx -y playwright@${VERSION} run-server --port 3000 --host 0.0.0.0 --unsafe`,
  ]);
  if (run.status !== 0) {
    process.stderr.write(run.stderr);
    return 1;
  }
  started = true;
  console.log(`Started ${CONTAINER} from ${IMAGE} (${PLATFORM}).`);

  const endpoint = await waitForServer();
  console.log(`Browser server ready at ${endpoint}.`);

  const child = spawn("pnpm", ["exec", "playwright", "test", "--project=screenshots", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, RH_PW_REMOTE_WS: endpoint },
  });
  return await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
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
