/**
 * Which of the Lighthouse URLs one run measures, so CI can spread the gate
 * across parallel jobs (`.depot/workflows/ci.yml`, `web-lighthouse`).
 * `lighthouserc.cjs` passes its URL list and `RH_LIGHTHOUSE_SHARD` through
 * `shard`, and `lighthouse.mts` warms the URLs the config ends up with, so
 * the two never disagree.
 *
 * `RH_LIGHTHOUSE_SHARD=i/n` takes every n-th URL starting at the i-th
 * (1-based), round robin, so the n shards between them measure every URL
 * exactly once, whatever the list's length. Unset or empty, the run measures
 * every URL, as on a laptop. Each URL's five runs stay in one shard, so the
 * medians, and the assertions on them, are the same as in one run of the
 * whole list: every assertion is per URL.
 *
 * The module also holds the two local settings of the smell test before a
 * push (`e2e/README.md`, "Lighthouse CI"): `runsPerUrl` reads
 * `RH_LIGHTHOUSE_RUNS` and `onlyPaths` reads `RH_LIGHTHOUSE_URLS`, and
 * `assertNoLocalOverrides` refuses both in CI. Pure, with no imports, so
 * `test/lighthouse-shard.test.ts` checks it without running Lighthouse.
 */
export function shard<T>(items: readonly T[], spec: string | undefined): T[] {
  if (spec === undefined || spec === "") return [...items];
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(spec);
  if (match === null) {
    throw new Error(`RH_LIGHTHOUSE_SHARD must be i/n, two whole numbers from 1 with i at most n, not ${JSON.stringify(spec)}.`);
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (index > total) {
    throw new Error(`RH_LIGHTHOUSE_SHARD ${spec} names shard ${index} of only ${total}.`);
  }
  const picked = items.filter((_, position) => position % total === index - 1);
  if (picked.length === 0) {
    throw new Error(`RH_LIGHTHOUSE_SHARD ${spec} has no URL to measure: there are only ${items.length}, so use at most ${items.length} shards.`);
  }
  return picked;
}

/** The runs per URL when nothing overrides it: every assertion reads the median of five. */
export const DEFAULT_RUNS = 5;

/**
 * The runs per URL, from `RH_LIGHTHOUSE_RUNS`. Unset or empty, five, as in
 * CI; `pnpm web:test:lighthouse:quick` sets it to 1 when it is unset, for the
 * local smell test before a push. The assertions read the median of
 * whatever runs there are, so a single run still fails on a missed budget,
 * only with more noise.
 */
export function runsPerUrl(spec: string | undefined): number {
  if (spec === undefined || spec === "") return DEFAULT_RUNS;
  if (!/^[1-9]\d*$/.test(spec)) {
    throw new Error(`RH_LIGHTHOUSE_RUNS must be a whole number from 1, not ${JSON.stringify(spec)}.`);
  }
  return Number(spec);
}

/**
 * The sampled Lighthouse URLs a run measures, from `RH_LIGHTHOUSE_URLS`: a
 * comma-separated list of paths exactly as `sampled-urls.mts` writes them,
 * trailing slash included, for a one-page change. Unset or empty, every
 * URL. The list keeps `items`' order, so the table reads as the full run's
 * does. A path that is not a sampled Lighthouse URL, an empty entry or a
 * repeat fails, naming the paths it accepts, so a typo never measures less
 * than it says.
 */
export function onlyPaths<T extends { readonly path: string }>(items: readonly T[], spec: string | undefined): T[] {
  if (spec === undefined || spec === "") return [...items];
  const known = items.map((item) => item.path);
  const wanted = spec.split(",");
  const unknown = wanted.filter((path) => !known.includes(path));
  if (unknown.length > 0) {
    throw new Error(
      `RH_LIGHTHOUSE_URLS names ${unknown.map((path) => JSON.stringify(path)).join(", ")}, not a sampled Lighthouse URL; use comma-separated paths from ${known.join(", ")}.`,
    );
  }
  const repeated = wanted.filter((path, position) => wanted.indexOf(path) !== position);
  if (repeated.length > 0) {
    throw new Error(`RH_LIGHTHOUSE_URLS names ${JSON.stringify(repeated[0])} more than once.`);
  }
  return items.filter((item) => wanted.includes(item.path));
}

/**
 * Refuses the local overrides in CI, so CI always measures every URL five
 * times and the medians job's coverage check (`lighthouse-merge.mts`, which
 * reads `numberOfRuns` from the config) always expects five. CI's workflow
 * sets `CI` on each Lighthouse job itself, rather than relying on the
 * host to. The shard is CI's own setting and is allowed.
 */
export function assertNoLocalOverrides(env: Readonly<Record<string, string | undefined>>): void {
  if (!env.CI) return;
  for (const name of ["RH_LIGHTHOUSE_RUNS", "RH_LIGHTHOUSE_URLS"]) {
    if (env[name] !== undefined && env[name] !== "") {
      throw new Error(`${name} is a local smell-test setting and is refused in CI (CI is set): CI measures every sampled URL ${DEFAULT_RUNS} times.`);
    }
  }
}
