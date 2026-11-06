import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { appServerEnv } from "./mock-cms/config.mts";

/**
 * A stamp the harness writes into `.next` after it builds the app for the
 * end-to-end run, and checks before it starts a build it did not make
 * (`RH_E2E_PREBUILT=1`, `config.mts`, `prebuilt`). Without it, a prebuilt
 * run would start whatever `.next` holds: a production build without the
 * fixture routes (`pnpm web:build` writes the same directory), or a fixture
 * build for other ports or older code, and fail later with a 404 or a wrong
 * origin that says nothing about the cause.
 *
 * The stamp records the build's ID (`.next/BUILD_ID`, new on every build),
 * the git commit checked out when it was built, and the environment the
 * build saw that changes its output (`BUILD_VARIABLES`); the check fails,
 * naming the difference, unless the stamp exists, belongs to the build in
 * `.next` now, was made at the commit checked out now, and matches what
 * `appServerEnv()` gives this run. The commit catches a build left from
 * before a pull or a checkout; uncommitted edits since the build are not
 * caught, so rebuild after changing files (unset `RH_E2E_PREBUILT`).
 *
 *   node e2e/build-stamp.mts write   after `next build`, in the build's environment
 *   node e2e/build-stamp.mts check   before `next start` of a prebuilt app
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const NEXT_DIR = join(APP_DIR, ".next");
const STAMP_FILE = "rh-e2e-build.json";

/**
 * The variables whose values are baked into the build's output:
 * `RH_FIXTURES` decides the routes (`pageExtensions`), `WP_API_URL` and
 * `WP_MEDIA_ORIGIN` the `/media/` rewrite (`next.config.ts`,
 * `mediaRewrites`), and `SITE_URL` the metadata base.
 */
export const BUILD_VARIABLES = ["RH_FIXTURES", "WP_API_URL", "WP_MEDIA_ORIGIN", "SITE_URL"] as const;

/** An environment to read the build variables and ports from: `process.env`, or a test's own. */
type Env = Readonly<Record<string, string | undefined>>;

export interface Stamp {
  buildId: string;
  /** `git rev-parse HEAD` when the build was made, or `null` outside a git checkout. */
  commit: string | null;
  env: Record<string, string | undefined>;
}

/** Where the stamp is read and written, and how the current commit is found; tests replace both. */
export interface StampOptions {
  nextDir?: string;
  commit?: () => string | null;
}

/** The commit checked out in the app's repository, or `null` when git cannot say. */
export function gitCommit(): string | null {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: APP_DIR, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function buildId(nextDir: string): string | null {
  const file = join(nextDir, "BUILD_ID");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

/** Records the build in `.next`, the commit and the environment it was built with. */
export function writeBuildStamp(env: Env = process.env, options: StampOptions = {}): void {
  const nextDir = options.nextDir ?? NEXT_DIR;
  const id = buildId(nextDir);
  if (id === null) throw new Error("There is no build in .next to stamp; run `next build` first.");
  const stamp: Stamp = {
    buildId: id,
    commit: (options.commit ?? gitCommit)(),
    env: Object.fromEntries(BUILD_VARIABLES.map((name) => [name, env[name]])),
  };
  writeFileSync(join(nextDir, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`);
}

/** Why the build in `.next` is not the one this run needs, or `null` when it is. */
export function buildStampProblem(env: Env = process.env, options: StampOptions = {}): string | null {
  const nextDir = options.nextDir ?? NEXT_DIR;
  const id = buildId(nextDir);
  if (id === null) return "there is no build in .next";
  const stampFile = join(nextDir, STAMP_FILE);
  if (!existsSync(stampFile)) {
    return `the build in .next was not made by the end-to-end harness (no .next/${STAMP_FILE}); it may be a production build from \`pnpm web:build\``;
  }
  const stamp = JSON.parse(readFileSync(stampFile, "utf8")) as Partial<Stamp>;
  if (stamp.buildId !== id) {
    return `the build in .next (${id}) is newer than the harness's stamp (${stamp.buildId}); something rebuilt it since`;
  }
  const commit = (options.commit ?? gitCommit)();
  if ((stamp.commit ?? null) !== commit) {
    return `the build in .next was made at commit ${stamp.commit ?? "(unknown)"}, but ${commit ?? "(unknown)"} is checked out now`;
  }
  const expected = appServerEnv(env);
  const differences = BUILD_VARIABLES.filter((name) => stamp.env?.[name] !== expected[name]).map(
    (name) => `${name} was ${JSON.stringify(stamp.env?.[name])}, this run needs ${JSON.stringify(expected[name])}`,
  );
  return differences.length === 0 ? null : `the build in .next was made with other settings: ${differences.join("; ")}`;
}

/** Throws, saying what to do, unless `.next` holds the harness's build for this run. */
export function assertPrebuilt(env: Env = process.env, options: StampOptions = {}): void {
  const problem = buildStampProblem(env, options);
  if (problem !== null) {
    throw new Error(`RH_E2E_PREBUILT=1, but ${problem}. Unset RH_E2E_PREBUILT to build, or run \`pnpm web:test:e2e\` first with the same ports.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === "write") writeBuildStamp();
    else if (command === "check") assertPrebuilt();
    else throw new Error(`Usage: node e2e/build-stamp.mts write|check (got ${JSON.stringify(command)}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
