import { describe, expect, it } from "vitest";

import { cell, median, medianTable, rawTaskTime, type Lhr } from "../e2e/lighthouse-summary.mts";

// The medians Lighthouse's runner prints and puts in CI's job summary
// (e2e/lighthouse-summary.mts).

describe("median", () => {
  it("is null with no values", () => {
    expect(median([])).toBeNull();
  });

  it("is the middle value of an odd count, in any order", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([0.98, 0.91, 1])).toBe(0.98);
  });

  it("is the mean of the two middle values of an even count, as lhci assert computes it", () => {
    expect(median([10, 40, 20, 30])).toBe(25);
    expect(median([1200, 1000])).toBe(1100);
  });

  it("leaves its argument unsorted", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("cell", () => {
  it("formats a value", () => {
    expect(cell(0.987, (value) => value.toFixed(2))).toBe("0.99");
  });

  it("is n/a without one", () => {
    expect(cell(null, () => "never")).toBe("n/a");
  });
});

function lhr(
  url: string,
  numbers: { performance?: number | null; lcp?: number; cls?: number; tbt?: number; raw?: number; benchmarkIndex?: number; slowdown?: number },
): Lhr {
  return {
    requestedUrl: url,
    ...(numbers.benchmarkIndex === undefined ? {} : { environment: { benchmarkIndex: numbers.benchmarkIndex } }),
    ...(numbers.slowdown === undefined ? {} : { configSettings: { throttling: { cpuSlowdownMultiplier: numbers.slowdown } } }),
    categories: {
      ...(numbers.performance === undefined ? {} : { performance: { score: numbers.performance } }),
      accessibility: { score: 1 },
    },
    audits: {
      ...(numbers.lcp === undefined ? {} : { "largest-contentful-paint": { numericValue: numbers.lcp } }),
      ...(numbers.cls === undefined ? {} : { "cumulative-layout-shift": { numericValue: numbers.cls } }),
      ...(numbers.tbt === undefined ? {} : { "total-blocking-time": { numericValue: numbers.tbt } }),
      ...(numbers.raw === undefined ? {} : { diagnostics: { details: { items: [{ numTasks: 100, totalTaskTime: numbers.raw }] } } }),
    },
  };
}

describe("rawTaskTime", () => {
  it("is the diagnostics audit's totalTaskTime", () => {
    expect(rawTaskTime(lhr("http://localhost:3310/", { raw: 56.4 }))).toBe(56.4);
  });

  it("is null when the audit, its item or the number is missing or not a number", () => {
    const base = lhr("http://localhost:3310/", {});
    expect(rawTaskTime(base)).toBeNull();
    for (const details of [{}, { items: [] }, { items: [null] }, { items: [{ totalTaskTime: "56" }] }, { items: [{ totalTaskTime: Number.NaN }] }]) {
      expect(rawTaskTime({ ...base, audits: { diagnostics: { details } } }), JSON.stringify(details)).toBeNull();
    }
  });
});

describe("medianTable", () => {
  it("has one row per URL with the median of each number, and n/a where every run lacked it", () => {
    const table = medianTable(
      [
        lhr("http://localhost:3310/", { performance: 0.99, lcp: 900.4, cls: 0, tbt: 10, raw: 61.2, benchmarkIndex: 2100.5, slowdown: 6.4 }),
        lhr("http://localhost:3310/resources/", { performance: null, lcp: 1500 }),
        lhr("http://localhost:3310/", { performance: 0.97, lcp: 1100.6, cls: 0.0123, tbt: 30, raw: 58.6, benchmarkIndex: 2000, slowdown: 6.4 }),
        lhr("http://localhost:3310/", { performance: 1, lcp: 1000, cls: 0.002, tbt: 20, raw: 70, benchmarkIndex: 2050, slowdown: 6.4 }),
      ],
      3,
    );
    expect(table).toBe(
      [
        "### Lighthouse (mobile, median of 3)",
        "",
        "| URL | Runs | Performance | Accessibility | LCP (ms) | CLS | TBT (ms) | Raw main thread (ms) | benchmarkIndex | CPU slowdown |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        "| / | 3 | 0.99 | 1.00 | 1000 | 0.002 | 20 | 61 | 2050 | 6.4x |",
        "| /resources/ | 1 | n/a | 1.00 | 1500 | n/a | n/a | n/a | n/a | n/a |",
        "",
      ].join("\n"),
    );
  });

  it("says under the heading how the CPU slowdown was calibrated, when it was", () => {
    const calibration = { workMs: 235.6, runs: 3, referenceMs: 800, multiplier: 3.4, benchmarkIndex: 1856.5, formula: "the formula", reference: "the device" };
    const table = medianTable([lhr("http://localhost:3310/", { tbt: 20, benchmarkIndex: 2051, slowdown: 3.4 })], 5, calibration);
    expect(table.split("\n").slice(0, 3)).toEqual([
      "### Lighthouse (mobile, median of 5)",
      "",
      "CPU slowdown 3.4x: the calibration page's 800 ms on the device, over its 236 ms on this host (the median raw main-thread time of 3 runs). Formula: the formula. This host's benchmarkIndex in those runs: 1857, reported only.",
    ]);
    expect(medianTable([], 5, { ...calibration, benchmarkIndex: null }).split("\n")[2]).toMatch(/benchmarkIndex in those runs: n\/a, reported only\.$/);
  });
});
