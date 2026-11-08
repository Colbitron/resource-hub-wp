/**
 * A Playwright browser server in Playwright's official Linux Docker image,
 * pinned by digest (`playwright-image.mts`), for the two things that must
 * draw the same pixels on a laptop and in CI: the specimen's screenshot
 * baselines (`screenshots.mts`) and the committed brand PNGs
 * (`scripts/render-brand-images.mts`).
 *
 * The container runs only the browser server (`playwright run-server`); the
 * client stays on the host and connects to it. The server is the
 * repository's own installed `playwright-core`, mounted read-only into the
 * container, rather than a package fetched from npm on each run: nothing is
 * downloaded but the pinned image, and the server is the same version as the
 * client by construction. Starting refuses when that version and the image's
 * differ.
 *
 * The image is pinned to linux/amd64, the platform of CI's runners, so an
 * Apple-silicon laptop renders under emulation the same pixels CI does.
 * `RH_PW_DOCKER_PLATFORM` overrides it. The container gets a name of its own
 * and a free host port from Docker, and only that container is stopped;
 * nothing else running in Docker is touched.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { PLAYWRIGHT_IMAGE, PLAYWRIGHT_IMAGE_VERSION } from "./playwright-image.mts";

const require = createRequire(import.meta.url);
const TEST_DIR = dirname(require.resolve("@playwright/test/package.json"));
/** The `playwright-core` the test runner uses, resolved through `@playwright/test` as the runner resolves it. */
const CORE_DIR = realpathSync(dirname(require.resolve("playwright-core/package.json", { paths: [TEST_DIR] })));
const CORE_VERSION: string = require(`${CORE_DIR}/package.json`).version;
const CORE_MOUNT = "/opt/playwright-core";
const PLATFORM = process.env.RH_PW_DOCKER_PLATFORM || "linux/amd64";
const PATH_VARIABLE = "RH_PW_PATH";
/** Starting Chromium's server under emulation can take a while on a cold machine. */
const START_TIMEOUT_MS = 120_000;

/**
 * Chromium's arguments for a browser this server launches. No zygote:
 * Chromium's renderers crash without it when the amd64 image runs under QEMU
 * on an Apple-silicon laptop. The flag only changes how renderer processes
 * start, not how they paint, and it is set everywhere, CI included, so every
 * image is drawn the same way. The test runner sends the same through its
 * project's `launchOptions` (`playwright.config.ts`); a plain client sends
 * `LAUNCH_HEADERS` when it connects.
 */
export const CHROMIUM_ARGS = ["--no-zygote"] as const;

/** The header a plain `chromium.connect()` sends so the server launches its browser with `CHROMIUM_ARGS`, as the test runner does. */
export const LAUNCH_HEADERS = { "x-playwright-launch-options": JSON.stringify({ args: CHROMIUM_ARGS }) } as const;

function docker(args: string[], env: NodeJS.ProcessEnv = process.env): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("docker", args, { encoding: "utf8", env });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * One running browser container. `start()` runs it; `endpoint()` waits for
 * the server and gives its WebSocket URL; `stop()` stops it (started with
 * `--rm`, so stopping removes it), is synchronous so it can run from an
 * `exit` handler, and does nothing the second time or before a start.
 */
export class BrowserContainer {
  readonly name = `rh-playwright-${randomBytes(4).toString("hex")}`;

  /**
   * The server's endpoint path: random, so unguessable, but not a secret.
   * The server must run with `--unsafe` (below), which lets any client that
   * reaches it launch Chromium with arguments of its choosing; the port is
   * published on the host's loopback only, and the path keeps a local process
   * that merely finds the port from using it.
   *
   * It is not in the `docker` command line: Docker takes it from the
   * environment (`--env RH_PW_PATH` with no value inherits it) and the
   * container's shell expands it. Nothing here prints it: Docker's errors
   * and the container's log are redacted before they are shown. A client's
   * output is not: Playwright's own errors when it cannot connect, or loses
   * the connection, may name the endpoint. It can also be read from the
   * environment of a test runner given it (`RH_PW_REMOTE_WS`), which needs
   * this user's rights; from `docker inspect`, which needs Docker's, a
   * superset of the browser's; and, on a Linux host, where container
   * processes show in the host's `ps`, from the server's own arguments,
   * since `run-server` reads the path from nowhere else. A local user who
   * reads it there can use the server while the run lasts, which is why the
   * container is locked down below and lives only for the run; CI's runners
   * are single-tenant VMs.
   */
  readonly #endpointPath = `/${randomBytes(16).toString("hex")}`;
  #started = false;

  /** Text from the container with the endpoint path replaced, so nothing printed carries it. */
  redact(text: string): string {
    return text.split(this.#endpointPath).join("/<endpoint path>");
  }

  /** Runs the container, detached; throws, with Docker's redacted error, when it cannot. */
  start(): void {
    if (CORE_VERSION !== PLAYWRIGHT_IMAGE_VERSION) {
      throw new Error(
        `The installed playwright-core is ${CORE_VERSION}, but the browser image is pinned to ${PLAYWRIGHT_IMAGE_VERSION}; update e2e/playwright-image.mts as its comment says.`,
      );
    }
    // Docker's --mount value is comma-separated fields; a comma or a quote in
    // the path would split or end the `source` field.
    if (/[,"]/.test(CORE_DIR)) {
      throw new Error(`The path to playwright-core (${CORE_DIR}) holds a comma or a double quote, which Docker's --mount cannot take; move the checkout.`);
    }
    const run = docker(
      [
        "run",
        "--detach",
        "--rm",
        "--init",
        "--name",
        this.name,
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
        // The endpoint path, from this process's environment (below), never
        // from the command line.
        "--env",
        PATH_VARIABLE,
        PLAYWRIGHT_IMAGE,
        "sh",
        "-c",
        // --unsafe lets the client pass Chromium arguments: `CHROMIUM_ARGS`,
        // without which the renderers crash under QEMU. There is no other way
        // to give a run-server browser an argument: the server takes none of
        // its own, and `launch-server`, which takes launch options from a
        // file, serves a pre-launched browser without the network proxy
        // `exposeNetwork` needs to reach the host's app (playwright-core
        // 1.64.1). Hence the loopback-only port, the random endpoint path and
        // the dropped privileges above.
        `exec node ${CORE_MOUNT}/cli.js run-server --port 3000 --host 0.0.0.0 --path "$${PATH_VARIABLE}" --unsafe`,
      ],
      { ...process.env, [PATH_VARIABLE]: this.#endpointPath },
    );
    if (run.status !== 0) {
      throw new Error(`docker run failed:\n${this.redact(run.stderr)}`);
    }
    this.#started = true;
    console.log(`Started ${this.name} from ${PLAYWRIGHT_IMAGE} (${PLATFORM}), serving playwright-core ${CORE_VERSION}.`);
  }

  /** The server's WebSocket endpoint, once its log says it listens. */
  async endpoint(): Promise<string> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const logs = docker(["logs", this.name]);
      if (/Listening on ws:\/\//.test(logs.stdout + logs.stderr)) {
        const port = docker(["port", this.name, "3000/tcp"]).stdout.trim().split("\n")[0];
        const match = /:(\d+)$/.exec(port ?? "");
        if (!match) throw new Error(`Could not read the browser server's port from "${port}".`);
        console.log("Browser server ready.");
        return `ws://127.0.0.1:${match[1]}${this.#endpointPath}`;
      }
      const state = docker(["inspect", "--format", "{{.State.Running}}", this.name]);
      if (state.stdout.trim() !== "true") {
        throw new Error(`The browser container stopped before it was ready:\n${this.redact(logs.stdout + logs.stderr)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`The browser server did not start within ${START_TIMEOUT_MS / 1000} s.`);
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    // Started with --rm, so stopping it removes it too.
    docker(["stop", "--time", "5", this.name]);
  }
}
