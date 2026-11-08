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
 * whole list: every assertion is per URL. Pure, with no imports, so
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
