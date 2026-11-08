/**
 * Merges the raw runs of the Lighthouse shards CI measures in parallel
 * (`RH_LIGHTHOUSE_SHARD`, `lighthouse-shard.mts`) into the one table of
 * medians a single run of `lighthouse.mts` prints, and checks that every
 * Lighthouse URL was measured exactly as often as the config says.
 *
 *   node e2e/lighthouse-merge.mts <directory>
 *
 * Reads every `lhr-*.json` under the directory, at any depth (CI downloads
 * each shard's `.lighthouseci/` into a directory of its own), prints the
 * table and appends it to `$GITHUB_STEP_SUMMARY` in CI, with rows in the
 * order of `sampled-urls.mts`. Exits 1, naming each gap, when a URL has
 * other than `numberOfRuns` runs or a run is for a URL the config does not
 * list, and with a plain "no Lighthouse artifacts found" when the directory
 * is missing or holds no run, which is what a run whose shards uploaded
 * nothing looks like. It decides nothing about the budgets: each shard
 * asserted its own URLs, and every assertion reads one URL's median, which
 * is the same in a shard as in a run of the whole list.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { coverageProblems, medianTable, type Lhr } from "./lighthouse-summary.mts";

/**
 * The `lhr-*.json` files under `directory`, at any depth, relative to it; or
 * the reason there are none, so the caller reports that instead of an
 * ENOENT stack or a list of every URL missing.
 */
export function findRunFiles(directory: string): { files: string[] } | { problem: string } {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return { problem: `No Lighthouse artifacts found: ${resolve(directory)} does not exist, so no shard uploaded its reports.` };
  }
  const files = readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((path) => /^lhr-.*\.json$/.test(basename(path)))
    .toSorted();
  if (files.length === 0) {
    return { problem: `No Lighthouse artifacts found: ${resolve(directory)} holds no lhr-*.json file.` };
  }
  return { files };
}

function main(): number {
  const directory = process.argv[2];
  if (directory === undefined) {
    console.error("Usage: node e2e/lighthouse-merge.mts <directory holding the shards' lhr-*.json files>");
    return 1;
  }
  const found = findRunFiles(directory);
  if ("problem" in found) {
    console.error(found.problem);
    return 1;
  }

  // The whole list, whatever shard the environment names.
  delete process.env.RH_LIGHTHOUSE_SHARD;
  const require = createRequire(import.meta.url);
  const collect: { numberOfRuns: number; url: string[] } = require("../lighthouserc.cjs").ci.collect;

  const order = (lhr: Lhr) => {
    const index = collect.url.indexOf(lhr.requestedUrl);
    return index === -1 ? collect.url.length : index;
  };
  const runs = found.files
    .map((path) => JSON.parse(readFileSync(join(directory, path), "utf8")) as Lhr)
    .sort((a, b) => order(a) - order(b));

  const table = medianTable(runs, collect.numberOfRuns);
  console.log(`${table}\nMerged ${runs.length} runs from ${resolve(directory)}.`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);

  const problems = coverageProblems(runs, collect.url, collect.numberOfRuns);
  if (problems.length > 0) {
    console.error(`The shards' runs are incomplete: ${problems.join("; ")}.`);
    return 1;
  }
  return 0;
}

// Run as a script, not when a test imports findRunFiles.
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
