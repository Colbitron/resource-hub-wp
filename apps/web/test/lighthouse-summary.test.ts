import { describe, expect, it } from "vitest";

import { cell, coverageProblems, median, medianTable, type Lhr } from "../e2e/lighthouse-summary.mts";

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

function lhr(url: string, numbers: { performance?: number | null; lcp?: number; cls?: number; tbt?: number }): Lhr {
  return {
    requestedUrl: url,
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
        lhr("http://localhost:3310/", { performance: 0.99, lcp: 900.4, cls: 0, tbt: 10 }),
        lhr("http://localhost:3310/resources/", { performance: null, lcp: 1500 }),
        lhr("http://localhost:3310/", { performance: 0.97, lcp: 1100.6, cls: 0.0123, tbt: 30 }),
        lhr("http://localhost:3310/", { performance: 1, lcp: 1000, cls: 0.002, tbt: 20 }),
      ],
      3,
    );
    expect(table).toBe(
      [
        "### Lighthouse (mobile, median of 3)",
        "",
        "| URL | Runs | Performance | Accessibility | LCP (ms) | CLS | TBT (ms) |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        "| / | 3 | 0.99 | 1.00 | 1000 | 0.002 | 20 |",
        "| /resources/ | 1 | n/a | 1.00 | 1500 | n/a | n/a |",
        "",
      ].join("\n"),
    );
  });
});

describe("coverageProblems", () => {
  const home = "http://localhost:3310/";
  const library = "http://localhost:3310/resources/";
  const runs = (url: string, count: number) => Array.from({ length: count }, () => lhr(url, {}));

  it("is empty when every expected URL has its runs and nothing else was measured", () => {
    expect(coverageProblems([...runs(home, 5), ...runs(library, 5)], [home, library], 5)).toEqual([]);
  });

  it("names a URL with no runs, as when a shard's reports never arrived", () => {
    expect(coverageProblems(runs(home, 5), [home, library], 5)).toEqual([`${library} has 0 runs, not 5`]);
  });

  it("names a URL with too few or too many runs", () => {
    expect(coverageProblems([...runs(home, 4), ...runs(library, 10)], [home, library], 5)).toEqual([
      `${home} has 4 runs, not 5`,
      `${library} has 10 runs, not 5`,
    ]);
  });

  it("names a URL that was measured but not expected", () => {
    expect(coverageProblems([...runs(home, 5), ...runs(library, 5)], [home], 5)).toEqual([
      `${library} was measured but is not a Lighthouse URL`,
    ]);
  });
});
