import { describe, expect, it } from "vitest";

import { MAX_SKEW_MS, SKEW_MARGIN_MS, skewWaitMs } from "../e2e/revalidation.mts";

// The end-to-end harness's wait after a revalidation (e2e/revalidation.mts):
// the server's wall clock ahead of its monotonic clock, plus a margin, and a
// plain failure past the limit.

describe("skewWaitMs", () => {
  it("waits the skew plus the margin when the wall clock is ahead", () => {
    expect(skewWaitMs(30)).toBe(30 + SKEW_MARGIN_MS);
    expect(skewWaitMs(43.2)).toBeCloseTo(43.2 + SKEW_MARGIN_MS);
  });

  it("waits only the margin when the wall clock is level or behind", () => {
    expect(skewWaitMs(0)).toBe(SKEW_MARGIN_MS);
    expect(skewWaitMs(-120)).toBe(SKEW_MARGIN_MS);
  });

  it("waits at the limit itself", () => {
    expect(skewWaitMs(MAX_SKEW_MS)).toBe(MAX_SKEW_MS + SKEW_MARGIN_MS);
    expect(skewWaitMs(-MAX_SKEW_MS)).toBe(SKEW_MARGIN_MS);
  });

  it("fails past the limit either way, naming the skew and the clock check", () => {
    expect(() => skewWaitMs(400)).toThrow(/400\.0 ms ahead of its monotonic clock/);
    expect(() => skewWaitMs(400)).toThrow(/process == "timed"/);
    expect(() => skewWaitMs(-400)).toThrow(/400\.0 ms behind/);
  });

  it("fails on a value that is not a number of milliseconds", () => {
    expect(() => skewWaitMs(Number.NaN)).toThrow(/not a number of milliseconds/);
  });
});
