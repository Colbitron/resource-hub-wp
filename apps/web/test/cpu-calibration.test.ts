import { describe, expect, it } from "vitest";

import { calibratedSlowdown, MAX_MULTIPLIER, MIN_MULTIPLIER, multiplierFor, slowdownFromEnv } from "../e2e/cpu-calibration.mts";

// The CPU slowdown the Lighthouse gate calibrates to its host
// (e2e/cpu-calibration.mts): Lighthouse's CPU slowdown calculator's formula,
// rounded and bounded.

describe("multiplierFor", () => {
  it("is the calculator's piecewise line through its knots", () => {
    expect(multiplierFor(150)).toBe(1);
    expect(multiplierFor(800)).toBe(2);
    expect(multiplierFor(1300)).toBe(3);
    expect(multiplierFor(1300 + 233)).toBe(4);
  });

  it("matches the calculator's output for indexes CI's runners and a laptop reported", () => {
    // The calculator prints one decimal; these are its outputs for the inputs.
    expect(multiplierFor(475)?.toFixed(1)).toBe("1.5");
    expect(multiplierFor(1050)?.toFixed(1)).toBe("2.5");
    expect(multiplierFor(2050)?.toFixed(1)).toBe("6.2");
    expect(multiplierFor(3650)?.toFixed(1)).toBe("13.1");
    expect(multiplierFor(4100)?.toFixed(1)).toBe("15.0");
  });

  it("refuses where the calculator does: below 150, or not a number", () => {
    expect(multiplierFor(149.9)).toBeNull();
    expect(multiplierFor(0)).toBeNull();
    expect(multiplierFor(Number.NaN)).toBeNull();
    expect(multiplierFor(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("calibratedSlowdown", () => {
  it("rounds to one decimal, as the calculator prints it", () => {
    expect(calibratedSlowdown(2050)).toBe(6.2);
    expect(calibratedSlowdown(4100)).toBe(15);
  });

  it("accepts the bounds themselves", () => {
    expect(calibratedSlowdown(150)).toBe(MIN_MULTIPLIER);
    expect(calibratedSlowdown(1300 + 17 * 233)).toBe(MAX_MULTIPLIER);
  });

  it("stops, naming the index and the range, on a host the method does not cover", () => {
    expect(() => calibratedSlowdown(120)).toThrow(/benchmarkIndex is 120, which calibrates to no multiplier .*1x to 20x/);
    expect(() => calibratedSlowdown(6000)).toThrow(/benchmarkIndex is 6000, which calibrates to 23\.2x; the gate accepts 1x to 20x/);
  });
});

describe("slowdownFromEnv", () => {
  it("is undefined when unset or empty, so Lighthouse's own 4x applies", () => {
    expect(slowdownFromEnv({})).toBeUndefined();
    expect(slowdownFromEnv({ RH_LH_CPU_SLOWDOWN: "" })).toBeUndefined();
  });

  it("reads a multiplier inside the bounds", () => {
    expect(slowdownFromEnv({ RH_LH_CPU_SLOWDOWN: "6.2" })).toBe(6.2);
    expect(slowdownFromEnv({ RH_LH_CPU_SLOWDOWN: "20" })).toBe(20);
  });

  it("refuses anything else", () => {
    for (const raw of ["0.9", "20.1", "abc", "6x", "-4", " 4"]) {
      expect(() => slowdownFromEnv({ RH_LH_CPU_SLOWDOWN: raw }), raw).toThrow(/RH_LH_CPU_SLOWDOWN must be a number from 1 to 20/);
    }
  });
});
