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
 * list. It decides nothing about the budgets: each shard asserted its own
 * URLs, and every assertion reads one URL's median, which is the same in a
 * shard as in a run of the whole list.
 */

import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";

import { coverageProblems, medianTable, type Lhr } from "./lighthouse-summary.mts";

// The whole list, whatever shard the environment names.
delete process.env.RH_LIGHTHOUSE_SHARD;
const require = createRequire(import.meta.url);
const COLLECT: { numberOfRuns: number; url: string[] } = require("../lighthouserc.cjs").ci.collect;

function main(): number {
  const directory = process.argv[2];
  if (directory === undefined) {
    console.error("Usage: node e2e/lighthouse-merge.mts <directory holding the shards' lhr-*.json files>");
    return 1;
  }
  const files = readdirSync(directory, { recursive: true, encoding: "utf8" }).filter((path) =>
    /^lhr-.*\.json$/.test(basename(path)),
  );
  const order = (lhr: Lhr) => {
    const index = COLLECT.url.indexOf(lhr.requestedUrl);
    return index === -1 ? COLLECT.url.length : index;
  };
  const runs = files
    .map((path) => JSON.parse(readFileSync(join(directory, path), "utf8")) as Lhr)
    .sort((a, b) => order(a) - order(b));

  const table = medianTable(runs, COLLECT.numberOfRuns);
  console.log(`${table}\nMerged ${runs.length} runs from ${resolve(directory)}.`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);

  const problems = coverageProblems(runs, COLLECT.url, COLLECT.numberOfRuns);
  if (problems.length > 0) {
    console.error(`The shards' runs are incomplete: ${problems.join("; ")}.`);
    return 1;
  }
  return 0;
}

process.exit(main());
