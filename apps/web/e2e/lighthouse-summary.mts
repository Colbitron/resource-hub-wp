/**
 * The table of medians `lighthouse.mts` prints and adds to the CI job
 * summary, from the raw runs `lhci collect` writes. Pure, with no imports,
 * so `test/lighthouse-summary.test.ts` checks it without running Lighthouse.
 */

/** The parts of a Lighthouse result the table reads. */
export interface Lhr {
  requestedUrl: string;
  categories: Record<string, { score: number | null } | undefined>;
  audits: Record<string, { numericValue?: number } | undefined>;
}

/**
 * The median, or `null` when no run produced the number (an audit that
 * errored in every run). With an even count it is the mean of the two
 * middle values, as `lhci assert`'s `median` aggregation computes it
 * (`@lhci/utils`, `assertions.js`), so the table shows the number the
 * budget was checked against.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor((sorted.length - 1) / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle] + sorted[middle + 1]) / 2;
}

/** A median for the table, or "n/a" when there is none. */
export function cell(value: number | null, format: (value: number) => string): string {
  return value === null ? "n/a" : format(value);
}

/** The median of each budgeted number per URL, as a Markdown table under a heading naming the runs per URL. */
export function medianTable(runs: readonly Lhr[], runsPerUrl: number): string {
  const byUrl = new Map<string, Lhr[]>();
  for (const lhr of runs) {
    byUrl.set(lhr.requestedUrl, [...(byUrl.get(lhr.requestedUrl) ?? []), lhr]);
  }
  const rows = [
    "| URL | Runs | Performance | Accessibility | LCP (ms) | CLS | TBT (ms) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const fixed = (digits: number) => (value: number) => value.toFixed(digits);
  const whole = (value: number) => String(Math.round(value));
  for (const [url, lhrs] of byUrl) {
    const pick = (read: (lhr: Lhr) => number | null | undefined) =>
      median(lhrs.map(read).filter((value): value is number => typeof value === "number"));
    rows.push(
      `| ${new URL(url).pathname} | ${lhrs.length} | ${cell(pick((l) => l.categories.performance?.score), fixed(2))} | ${cell(pick((l) => l.categories.accessibility?.score), fixed(2))} | ${cell(pick((l) => l.audits["largest-contentful-paint"]?.numericValue), whole)} | ${cell(pick((l) => l.audits["cumulative-layout-shift"]?.numericValue), fixed(3))} | ${cell(pick((l) => l.audits["total-blocking-time"]?.numericValue), whole)} |`,
    );
  }
  return `### Lighthouse (mobile, median of ${runsPerUrl})\n\n${rows.join("\n")}\n`;
}

/**
 * What is missing or extra in runs merged from several Lighthouse shards
 * (`lighthouse-merge.mts`): each expected URL should have exactly
 * `runsPerUrl` runs, and no other URL any. Empty when the runs are
 * complete, so a shard whose reports never arrived cannot leave a URL out
 * of the table unnoticed.
 */
export function coverageProblems(runs: readonly Lhr[], expectedUrls: readonly string[], runsPerUrl: number): string[] {
  const counts = new Map<string, number>();
  for (const lhr of runs) counts.set(lhr.requestedUrl, (counts.get(lhr.requestedUrl) ?? 0) + 1);
  const problems = expectedUrls
    .filter((url) => counts.get(url) !== runsPerUrl)
    .map((url) => `${url} has ${counts.get(url) ?? 0} runs, not ${runsPerUrl}`);
  for (const url of counts.keys()) {
    if (!expectedUrls.includes(url)) problems.push(`${url} was measured but is not a Lighthouse URL`);
  }
  return problems;
}
