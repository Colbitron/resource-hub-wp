/**
 * The table of medians `lighthouse.mts` prints and adds to the CI job
 * summary, from the raw runs `lhci collect` writes. Pure, with no imports,
 * so `test/lighthouse-summary.test.ts` checks it without running Lighthouse.
 */

/** The parts of a Lighthouse result the table reads. */
export interface Lhr {
  requestedUrl: string;
  categories: Record<string, { score: number | null } | undefined>;
  audits: Record<string, { numericValue?: number; details?: { items?: readonly unknown[] } } | undefined>;
  /** The host's CPU/Memory Power, which Lighthouse measures on every run. */
  environment?: { benchmarkIndex?: number };
  configSettings?: { throttling?: { cpuSlowdownMultiplier?: number } };
}

/** How the run's CPU slowdown was chosen (`cpu-calibration.mts`), for the table's heading. */
export interface Calibration {
  /** The median raw main-thread time of the calibration runs, in ms (W). */
  workMs: number;
  /** How many runs it is the median of. */
  runs: number;
  /** The calibration page's main-thread time on the reference device, in ms. */
  referenceMs: number;
  multiplier: number;
  /** The calibration runs' median `benchmarkIndex`, reported only. */
  benchmarkIndex: number | null;
  formula: string;
  reference: string;
}

/**
 * The run's main-thread task time as the host did it, in ms, unthrottled:
 * the `diagnostics` audit's `totalTaskTime`, which Lighthouse reads from the
 * trace rather than simulates, so the CPU slowdown does not change it. `null`
 * when the audit has no such number.
 */
export function rawTaskTime(lhr: Lhr): number | null {
  const item = lhr.audits.diagnostics?.details?.items?.[0];
  if (typeof item !== "object" || item === null) return null;
  const value = (item as { totalTaskTime?: unknown }).totalTaskTime;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

/**
 * The median of each budgeted number per URL, as a Markdown table under a
 * heading naming the runs per URL and, when given, how the CPU slowdown was
 * calibrated. Each row also has the median raw main-thread time and
 * `benchmarkIndex` its runs measured and the multiplier they ran with: the
 * raw time is the same measure the calibration took of its own page, so a
 * host that sped up or slowed down after the calibration shows.
 */
export function medianTable(runs: readonly Lhr[], runsPerUrl: number, calibration?: Calibration): string {
  const byUrl = new Map<string, Lhr[]>();
  for (const lhr of runs) {
    byUrl.set(lhr.requestedUrl, [...(byUrl.get(lhr.requestedUrl) ?? []), lhr]);
  }
  const rows = [
    "| URL | Runs | Performance | Accessibility | LCP (ms) | CLS | TBT (ms) | Raw main thread (ms) | benchmarkIndex | CPU slowdown |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const fixed = (digits: number) => (value: number) => value.toFixed(digits);
  const whole = (value: number) => String(Math.round(value));
  for (const [url, lhrs] of byUrl) {
    const pick = (read: (lhr: Lhr) => number | null | undefined) =>
      median(lhrs.map(read).filter((value): value is number => typeof value === "number"));
    rows.push(
      `| ${new URL(url).pathname} | ${lhrs.length} | ${cell(pick((l) => l.categories.performance?.score), fixed(2))} | ${cell(pick((l) => l.categories.accessibility?.score), fixed(2))} | ${cell(pick((l) => l.audits["largest-contentful-paint"]?.numericValue), whole)} | ${cell(pick((l) => l.audits["cumulative-layout-shift"]?.numericValue), fixed(3))} | ${cell(pick((l) => l.audits["total-blocking-time"]?.numericValue), whole)} | ${cell(pick(rawTaskTime), whole)} | ${cell(pick((l) => l.environment?.benchmarkIndex), whole)} | ${cell(pick((l) => l.configSettings?.throttling?.cpuSlowdownMultiplier), (value) => `${value}x`)} |`,
    );
  }
  const heading = `### Lighthouse (mobile, median of ${runsPerUrl})\n\n`;
  const method = calibration
    ? `CPU slowdown ${calibration.multiplier}x: the calibration page's ${calibration.referenceMs} ms on ${calibration.reference}, over its ${Math.round(calibration.workMs)} ms on this host (the median raw main-thread time of ${calibration.runs} runs). Formula: ${calibration.formula}. ` +
      `This host's benchmarkIndex in those runs: ${calibration.benchmarkIndex === null ? "n/a" : Math.round(calibration.benchmarkIndex)}, reported only.\n\n`
    : "";
  return `${heading}${method}${rows.join("\n")}\n`;
}
