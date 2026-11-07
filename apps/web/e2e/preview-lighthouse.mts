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
 * For each URL in `e2e/preview-urls.mts`, in order: one request with the
 * bypass header, so Lighthouse measures the page a reader gets rather than
 * ISR's first render, which must answer 200 (a redirect, a 401 or a 403 is
 * the preview refusing the header: the secret is missing or wrong); then
 * `lhci collect` for that URL alone, with `lighthouserc.preview.cjs`, the
 * gate's settings on the preview. A URL that fails either step gets a row
 * saying why, and the others are still measured, so one page that stopped
 * answering never blanks the table. Then every run is checked for requests
 * to origins other than the preview's, where the header would have gone
 * too (below); the clean runs are written as redacted copies to
 * `lighthouse-preview-results/` (the workflow's artifact); and the comment
 * (`lighthouse-preview-summary.mts`) is written or posted.
 *
 * Exit codes: 0 when every URL was measured and reported; 2 when some or
 * all could not be and the reasons reached the comment; 1 otherwise (bad
 * arguments, the secret not set, the comment not written or posted, the
 * secret found in an output, or sent to another origin). The workflow
 * turns 2 into a green job and 1 into a red one: through its `reported`
 * output when the comment never got out, and its `leak` output when the
 * secret went to another origin, which is reported in the comment first.
 *
 * The secret: never printed, and never allowed to leave this process in
 * anything it writes. Lighthouse records its settings in each report, so
 * the raw runs in `.lighthouseci/` hold the header under
 * `configSettings.extraHeaders`; the copies written for the artifact have
 * that field redacted, and every file there and the comment body are
 * searched for the value (and its URL-encoded form) before anything is
 * written or posted. A hit, or an error while the copies are being
 * written, deletes the directory, so the artifact step never finds
 * unchecked files. The raw directory is gitignored and never uploaded.
 * `lhci` and Chrome get a minimal environment, so the GitHub token never
 * reaches them. Chrome sends the header on every request the page makes,
 * so a run with a request to another origin (Vercel's preview toolbar
 * would be one) has sent the secret there: such runs are reported in the
 * comment but their reports are not written, and the process exits 1.
 * The runs a failed `lhci collect` finished are checked the same way.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { findStickyComment, foreignOrigins, previewComment, type PreviewLhr, type PreviewResult } from "./lighthouse-preview-summary.mts";
import { PREVIEW_URLS } from "./preview-urls.mts";

const APP_DIR = new URL("..", import.meta.url).pathname;
const RAW_DIR = join(APP_DIR, ".lighthouseci");
const REPORT_DIR = join(APP_DIR, "lighthouse-preview-results");
const HEADER = "x-vercel-protection-bypass";
const SECRET_VARIABLE = "VERCEL_PROTECTION_BYPASS";
/** What `lhci`, and through it Chrome, may see of this process's environment. */
const CHILD_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "PLAYWRIGHT_BROWSERS_PATH", "CHROME_PATH"];

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

/**
 * Runs `lhci collect` for one path and returns its runs, with the reason
 * when it failed: the runs it finished before failing carried the header,
 * so they are returned for the origin check whatever happened. The raw
 * directory is cleared first and holds only this path's runs.
 */
function collect(origin: string, path: string, secret: string): { runs: PreviewLhr[]; failure: string | null } {
  rmSync(RAW_DIR, { recursive: true, force: true });
  const env: Record<string, string> = { RH_PREVIEW_ORIGIN: origin, RH_PREVIEW_PATH: path, [SECRET_VARIABLE]: secret };
  for (const key of CHILD_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // Next.js's types make NODE_ENV a required key of ProcessEnv; lhci does not need it.
  const result = spawnSync("pnpm", ["exec", "lhci", "collect", "--config=./lighthouserc.preview.cjs"], {
    cwd: APP_DIR,
    stdio: "inherit",
    env: env as NodeJS.ProcessEnv,
  });
  const runs = readdirSync(RAW_DIR)
    .filter((name) => /^lhr-.*\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(RAW_DIR, name), "utf8")) as PreviewLhr);
  if (result.status !== 0) {
    return { runs, failure: `lhci collect exited with ${result.status ?? result.signal} on ${path}; its output is in the log.` };
  }
  if (runs.length === 0) return { runs, failure: `lhci collect wrote no runs for ${path}.` };
  return { runs, failure: null };
}

function containsSecret(text: string, secret: string): boolean {
  return text.includes(secret) || text.includes(encodeURIComponent(secret));
}

/**
 * Writes each run with the header redacted, then proves no file in the
 * directory holds the secret. Any error on the way deletes the directory,
 * so nothing unchecked is left for the artifact step.
 */
function writeReports(runs: readonly PreviewLhr[], secret: string): void {
  rmSync(REPORT_DIR, { recursive: true, force: true });
  try {
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
        throw new FatalError(`The report ${name} contained the bypass secret after redaction; the reports were deleted.`);
      }
    }
  } catch (error) {
    rmSync(REPORT_DIR, { recursive: true, force: true });
    throw error instanceof FatalError ? error : new FatalError(`The reports could not be written and were deleted: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface GitHubComment {
  id: number;
  body?: string | null;
  user?: { login?: string | null } | null;
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

  const results: PreviewResult[] = [];
  for (const sample of PREVIEW_URLS) {
    const url = `${options.origin}${sample.path}`;
    try {
      await warm(url, secret);
      console.log(`Warmed ${sample.path}; collecting ${RUNS} runs.`);
      results.push({ url, ...collect(options.origin, sample.path, secret) });
    } catch (error) {
      if (error instanceof FatalError) throw error;
      results.push({ url, runs: [], failure: error instanceof Error ? error.message : String(error) });
    }
  }

  // Every request Chrome made carried the header, so a run that reached
  // another origin sent the secret there. Its numbers are still reported,
  // its report is not written, and the process ends with 1 below.
  const leaks = new Map<string, Set<string>>();
  const clean: PreviewLhr[] = [];
  for (const result of results) {
    for (const run of result.runs) {
      const origins = foreignOrigins(run, options.origin);
      if (origins.length === 0) {
        clean.push(run);
        continue;
      }
      const seen = leaks.get(result.url) ?? new Set<string>();
      for (const origin of origins) seen.add(origin);
      leaks.set(result.url, seen);
    }
  }
  let failure: string | null = null;
  if (leaks.size > 0) {
    const where = [...leaks].map(([url, origins]) => `${new URL(url).pathname} → ${[...origins].join(", ")}`).join("; ");
    failure = `Requests went to origins other than the preview's, where the bypass header went too: ${where}. Those runs' reports were not kept. The page must request nothing but the preview itself for this run to be safe.`;
  }
  writeReports(clean, secret);

  const body = previewComment({ previewUrl: options.origin, sha: options.sha, runsPerUrl: RUNS, results, failure });
  if (containsSecret(body, secret)) throw new FatalError("The comment body contained the bypass secret; nothing was written or posted.");

  if (options.commentFile !== null) {
    writeFileSync(options.commentFile, body);
    console.log(`Wrote the comment to ${options.commentFile}.`);
  }
  if (options.pr !== null) await post(options.pr, body);
  // `leak` is how the workflow turns a green-by-default job red for this one case.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `reported=true\n${failure === null ? "" : "leak=true\n"}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);

  console.log(`\n${body}`);
  if (failure !== null) throw new FatalError(failure);
  const failed = results.filter((result) => result.failure !== null);
  if (failed.length > 0) {
    console.error(`${failed.length} of ${results.length} URLs could not be measured; the comment says why.`);
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
