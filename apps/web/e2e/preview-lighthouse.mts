/**
 * Measures a pull request's Vercel preview with Lighthouse and reports the
 * result as one comment on the pull request, updated in place on every run.
 * The Preview Lighthouse workflow (`.github/workflows/preview-lighthouse.yml`)
 * runs it; locally it writes the comment to a file instead.
 *
 *   node e2e/preview-lighthouse.mts --origin https://…vercel.app [--sha <commit>] (--pr <number> | --comment-file <path>)
 *
 * The environment: `VERCEL_PROTECTION_BYPASS`, the project's deployment
 * protection bypass secret (locally the value of `VERC_DEP_PROT` in
 * `.env.local`), always; `GITHUB_TOKEN` and `GITHUB_REPOSITORY` with `--pr`.
 *
 * In order: it requests each URL in `e2e/preview-urls.mts` once with the
 * bypass header, so Lighthouse measures the page a reader gets rather than
 * ISR's first render, and stops if one does not answer 200 (a redirect, a
 * 401 or a 403 is the preview refusing the header: the secret is missing or
 * wrong). Then `lhci collect` with `lighthouserc.preview.cjs`, the gate's
 * settings on the preview. Then it reads the raw runs from `.lighthouseci/`,
 * writes redacted copies to `lighthouse-preview-results/` (the workflow's
 * artifact), builds the comment (`lighthouse-preview-summary.mts`) and
 * writes or posts it. A failure anywhere in the measurement is reported in
 * the comment and still written or posted, with whatever rows were
 * measured, so the pull request shows what went wrong without a red check.
 *
 * Exit codes: 0 when measured and reported; 2 when the measurement failed
 * but the failure reached the comment; 1 otherwise (bad arguments, the
 * secret not set, the comment not written or posted, the secret found in
 * an output). The workflow turns 2 into a green job and 1 into a red one.
 *
 * The secret: never printed, and never allowed to leave this process in
 * anything it writes. Lighthouse records its settings in each report, so
 * the raw runs in `.lighthouseci/` hold the header under
 * `configSettings.extraHeaders`; the copies written for the artifact have
 * that field redacted, and every file there and the comment body are
 * searched for the value (and its URL-encoded form) before anything is
 * written or posted. A hit deletes the directory and exits 1. The raw
 * directory is gitignored and never uploaded.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { findStickyComment, previewComment, type PreviewLhr } from "./lighthouse-preview-summary.mts";
import { PREVIEW_URLS } from "./preview-urls.mts";

const APP_DIR = new URL("..", import.meta.url).pathname;
const RAW_DIR = join(APP_DIR, ".lighthouseci");
const REPORT_DIR = join(APP_DIR, "lighthouse-preview-results");
const HEADER = "x-vercel-protection-bypass";
const SECRET_VARIABLE = "VERCEL_PROTECTION_BYPASS";

const require = createRequire(import.meta.url);
/** The runs per URL, read from the gate's config, which the preview config spreads. */
const RUNS: number = require("../lighthouserc.cjs").ci.collect.numberOfRuns;

/** A failure that must not be reported as a measurement failure: the process exits 1 instead. */
class FatalError extends Error {}

interface Options {
  origin: string;
  sha: string | null;
  pr: number | null;
  commentFile: string | null;
}

function usage(message: string): never {
  throw new FatalError(
    `${message}\nUsage: node e2e/preview-lighthouse.mts --origin https://…vercel.app [--sha <commit>] (--pr <number> | --comment-file <path>)`,
  );
}

function parseOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      origin: { type: "string" },
      sha: { type: "string" },
      pr: { type: "string" },
      "comment-file": { type: "string" },
    },
    strict: true,
  });
  if (!values.origin) usage("--origin is required.");
  let origin: URL;
  try {
    origin = new URL(values.origin);
  } catch {
    usage(`--origin is not a URL: ${values.origin}`);
  }
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username) {
    usage(`--origin must be an https origin with no path, query or credentials, not ${values.origin}`);
  }
  if (values.sha !== undefined && !/^[0-9a-f]{7,40}$/.test(values.sha)) usage(`--sha is not a commit SHA: ${values.sha}`);
  if (values.pr !== undefined && !/^[1-9]\d*$/.test(values.pr)) usage(`--pr is not a pull request number: ${values.pr}`);
  if (values.pr === undefined && values["comment-file"] === undefined) usage("One of --pr and --comment-file is required.");
  return {
    origin: origin.origin,
    sha: values.sha ?? null,
    pr: values.pr === undefined ? null : Number(values.pr),
    commentFile: values["comment-file"] ?? null,
  };
}

/** The secret from the environment, checked for shape but never shown. */
function readSecret(): string {
  const value = process.env[SECRET_VARIABLE];
  if (!value) throw new FatalError(`${SECRET_VARIABLE} is not set; it is the preview's deployment protection bypass secret.`);
  if (/\s/.test(value)) throw new FatalError(`${SECRET_VARIABLE} contains whitespace, which no bypass secret does; check how it was set.`);
  return value;
}

/** Requests one page once with the header, as a reader would, so ISR has rendered it before Lighthouse arrives. */
async function warm(url: string, secret: string): Promise<void> {
  const path = new URL(url).pathname;
  let response: Response;
  try {
    response = await fetch(url, { headers: { [HEADER]: secret }, redirect: "manual", signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new Error(`${path} could not be fetched while warming: ${error instanceof Error ? error.message : String(error)}`);
  }
  await response.arrayBuffer();
  if (response.status === 200) return;
  if ((response.status >= 300 && response.status < 400) || response.status === 401 || response.status === 403) {
    throw new Error(
      `${path} answered ${response.status} while warming: the preview refused the \`${HEADER}\` header, so ${SECRET_VARIABLE} is missing or wrong for this project.`,
    );
  }
  throw new Error(`${path} answered ${response.status} while warming.`);
}

function collect(origin: string, secret: string): void {
  const result = spawnSync("pnpm", ["exec", "lhci", "collect", "--config=./lighthouserc.preview.cjs"], {
    cwd: APP_DIR,
    stdio: "inherit",
    env: { ...process.env, RH_PREVIEW_ORIGIN: origin, [SECRET_VARIABLE]: secret },
  });
  if (result.status !== 0) throw new Error(`lhci collect exited with ${result.status ?? result.signal}; its output is in the log.`);
}

function readRuns(): PreviewLhr[] {
  return readdirSync(RAW_DIR)
    .filter((name) => /^lhr-.*\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(RAW_DIR, name), "utf8")) as PreviewLhr);
}

function containsSecret(text: string, secret: string): boolean {
  return text.includes(secret) || text.includes(encodeURIComponent(secret));
}

/** Writes each run with the header redacted, then proves no file in the directory holds the secret. */
function writeReports(runs: readonly PreviewLhr[], secret: string): void {
  rmSync(REPORT_DIR, { recursive: true, force: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  runs.forEach((run, index) => {
    const copy = { ...run } as PreviewLhr & { configSettings?: { extraHeaders?: unknown } };
    if (copy.configSettings) {
      copy.configSettings = { ...copy.configSettings, extraHeaders: { [HEADER]: "[redacted]" } };
    }
    const slug = new URL(run.requestedUrl).pathname.replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "-") || "root";
    writeFileSync(join(REPORT_DIR, `lhr-${String(index + 1).padStart(2, "0")}-${slug}.json`), JSON.stringify(copy));
  });
  for (const name of readdirSync(REPORT_DIR)) {
    if (containsSecret(readFileSync(join(REPORT_DIR, name), "utf8"), secret)) {
      rmSync(REPORT_DIR, { recursive: true, force: true });
      throw new FatalError(`The report ${name} contained the bypass secret after redaction; the reports were deleted and nothing was posted.`);
    }
  }
}

interface GitHubComment {
  id: number;
  body?: string | null;
}

/** Creates the comment on the pull request, or edits the one carrying the marker. */
async function post(pr: number, body: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new FatalError("--pr needs GITHUB_TOKEN and GITHUB_REPOSITORY in the environment.");
  const api = `https://api.github.com/repos/${repository}/issues`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "resource-hub-preview-lighthouse",
  };
  const call = async (method: string, url: string, payload?: unknown): Promise<unknown> => {
    const response = await fetch(url, {
      method,
      headers: { ...headers, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new FatalError(`GitHub answered ${response.status} to ${method} ${url}.`);
    return response.json();
  };

  const comments: GitHubComment[] = [];
  for (let page = 1; ; page += 1) {
    const batch = (await call("GET", `${api}/${pr}/comments?per_page=100&page=${page}`)) as GitHubComment[];
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const existing = findStickyComment(comments);
  if (existing === null) {
    await call("POST", `${api}/${pr}/comments`, { body });
    console.log(`Posted a new comment on pull request #${pr}.`);
  } else {
    await call("PATCH", `${api}/comments/${existing}`, { body });
    console.log(`Updated comment ${existing} on pull request #${pr}.`);
  }
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  const secret = readSecret();

  let failure: string | null = null;
  let runs: PreviewLhr[] = [];
  try {
    for (const sample of PREVIEW_URLS) {
      await warm(`${options.origin}${sample.path}`, secret);
    }
    console.log(`Warmed ${PREVIEW_URLS.length} URLs on ${options.origin}; collecting ${RUNS} runs each.`);
    rmSync(RAW_DIR, { recursive: true, force: true });
    collect(options.origin, secret);
    runs = readRuns();
    if (runs.length === 0) throw new Error("lhci collect wrote no runs.");
    writeReports(runs, secret);
  } catch (error) {
    if (error instanceof FatalError) throw error;
    failure = error instanceof Error ? error.message : String(error);
  }

  const body = previewComment({ previewUrl: options.origin, sha: options.sha, runsPerUrl: RUNS, runs, failure });
  if (containsSecret(body, secret)) throw new FatalError("The comment body contained the bypass secret; nothing was written or posted.");

  if (options.commentFile !== null) {
    writeFileSync(options.commentFile, body);
    console.log(`Wrote the comment to ${options.commentFile}.`);
  }
  if (options.pr !== null) await post(options.pr, body);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "reported=true\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);

  console.log(`\n${body}`);
  if (failure !== null) {
    console.error(`The measurement failed: ${failure}`);
    return 2;
  }
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
}
process.exit(code);
