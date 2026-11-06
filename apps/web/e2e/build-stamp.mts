import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { appServerEnv } from "./mock-cms/config.mts";

/**
 * A stamp the harness writes into `.next` after it builds the app for the
 * end-to-end run, and checks before it starts a build it did not make
 * (`RH_E2E_PREBUILT=1`, `config.mts`, `prebuilt`). Without it, a prebuilt
 * run would start whatever `.next` holds: a production build without the
 * fixture routes (`pnpm web:build` writes the same directory), or a fixture
 * build for other ports, and fail later with a 404 or a wrong origin that
 * says nothing about the cause.
 *
 * The stamp records the build's ID (`.next/BUILD_ID`, new on every build) and
 * the environment the build saw that changes its output (`RH_FIXTURES`,
 * `WP_API_URL`, `SITE_URL`); the check fails, naming the difference, unless
 * the stamp exists, belongs to the build in `.next` now, and matches what
 * `appServerEnv()` gives this run.
 *
 *   node e2e/build-stamp.mts write   after `next build`, in the build's environment
 *   node e2e/build-stamp.mts check   before `next start` of a prebuilt app
 */

const NEXT_DIR = new URL("../.next/", import.meta.url);
const STAMP = new URL("rh-e2e-build.json", NEXT_DIR);
const BUILD_ID = new URL("BUILD_ID", NEXT_DIR);

/** The variables whose values are baked into the build's output. */
const BUILD_VARIABLES = ["RH_FIXTURES", "WP_API_URL", "SITE_URL"] as const;

interface Stamp {
  buildId: string;
  env: Record<string, string | undefined>;
}

function buildId(): string | null {
  return existsSync(BUILD_ID) ? readFileSync(BUILD_ID, "utf8").trim() : null;
}

/** Records the build in `.next` and the environment it was built with. */
export function writeBuildStamp(env: NodeJS.ProcessEnv = process.env): void {
  const id = buildId();
  if (id === null) throw new Error("There is no build in .next to stamp; run `next build` first.");
  const stamp: Stamp = { buildId: id, env: Object.fromEntries(BUILD_VARIABLES.map((name) => [name, env[name]])) };
  writeFileSync(STAMP, `${JSON.stringify(stamp, null, 2)}\n`);
}

/** Why the build in `.next` is not the one this run needs, or `null` when it is. */
export function buildStampProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = buildId();
  if (id === null) return "there is no build in .next";
  if (!existsSync(STAMP)) {
    return "the build in .next was not made by the end-to-end harness (no .next/rh-e2e-build.json); it may be a production build from `pnpm web:build`";
  }
  const stamp = JSON.parse(readFileSync(STAMP, "utf8")) as Stamp;
  if (stamp.buildId !== id) {
    return `the build in .next (${id}) is newer than the harness's stamp (${stamp.buildId}); something rebuilt it since`;
  }
  const expected = appServerEnv(env);
  const differences = BUILD_VARIABLES.filter((name) => stamp.env[name] !== expected[name]).map(
    (name) => `${name} was ${JSON.stringify(stamp.env[name])}, this run needs ${JSON.stringify(expected[name])}`,
  );
  return differences.length === 0 ? null : `the build in .next was made with other settings: ${differences.join("; ")}`;
}

/** Throws, saying what to do, unless `.next` holds the harness's build for this run. */
export function assertPrebuilt(env: NodeJS.ProcessEnv = process.env): void {
  const problem = buildStampProblem(env);
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
