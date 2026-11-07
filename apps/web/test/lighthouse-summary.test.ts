import { describe, expect, it } from "vitest";

import { cell, median, medianTable, type Lhr } from "../e2e/lighthouse-summary.mts";

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
  numbers: { performance?: number | null; lcp?: number; cls?: number; tbt?: number; benchmarkIndex?: number; slowdown?: number },
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
    },
  };
}

describe("medianTable", () => {
  it("has one row per URL with the median of each number, and n/a where every run lacked it", () => {
    const table = medianTable(
      [
        lhr("http://localhost:3310/", { performance: 0.99, lcp: 900.4, cls: 0, tbt: 10, benchmarkIndex: 2100.5, slowdown: 6.4 }),
        lhr("http://localhost:3310/resources/", { performance: null, lcp: 1500 }),
        lhr("http://localhost:3310/", { performance: 0.97, lcp: 1100.6, cls: 0.0123, tbt: 30, benchmarkIndex: 2000, slowdown: 6.4 }),
        lhr("http://localhost:3310/", { performance: 1, lcp: 1000, cls: 0.002, tbt: 20, benchmarkIndex: 2050, slowdown: 6.4 }),
      ],
      3,
    );
    expect(table).toBe(
      [
        "### Lighthouse (mobile, median of 3)",
        "",
        "| URL | Runs | Performance | Accessibility | LCP (ms) | CLS | TBT (ms) | benchmarkIndex | CPU slowdown |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        "| / | 3 | 0.99 | 1.00 | 1000 | 0.002 | 20 | 2050 | 6.4x |",
        "| /resources/ | 1 | n/a | 1.00 | 1500 | n/a | n/a | n/a | n/a |",
        "",
      ].join("\n"),
    );
  });

  it("says under the heading how the CPU slowdown was calibrated, when it was", () => {
    const table = medianTable([lhr("http://localhost:3310/", { tbt: 20, benchmarkIndex: 2051, slowdown: 6.2 })], 5, {
      benchmarkIndex: 2049.5,
      runs: 3,
      multiplier: 6.2,
      formula: "the formula",
      reference: "the device",
    });
    expect(table.split("\n").slice(0, 3)).toEqual([
      "### Lighthouse (mobile, median of 5)",
      "",
      "CPU slowdown 6.2x, calibrated from a benchmarkIndex of 2050 (the median of 3 runs) to simulate the device. Formula: the formula.",
    ]);
  });
});
