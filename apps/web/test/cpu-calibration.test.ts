import { describe, expect, it } from "vitest";

import {
  calibratedSlowdown,
  DERIVATION,
  FORMULA,
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
  multiplierFor,
  REFERENCE_MS,
  slowdownFromEnv,
} from "../e2e/cpu-calibration.mts";

// The CPU slowdown the Lighthouse gate calibrates to its host
// (e2e/cpu-calibration.mts): the calibration page's reference main-thread
// time over the host's own, rounded and bounded.

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

describe("REFERENCE_MS", () => {
  it("is the derivation host's calculator multiplier times its raw time, rounded", () => {
    expect(REFERENCE_MS).toBe(Math.round(multiplierFor(DERIVATION.benchmarkIndex)! * DERIVATION.rawMs));
  });

  it("comes from a measured host the calculator covers, on a desktop-class index", () => {
    expect(DERIVATION.rawMs).toBeGreaterThan(0);
    expect(multiplierFor(DERIVATION.benchmarkIndex)).toBeGreaterThan(MIN_MULTIPLIER);
    expect(Number.isInteger(REFERENCE_MS)).toBe(true);
  });

  it("is named, with its inputs, in the formula the summary prints", () => {
    expect(FORMULA).toContain(`REFERENCE_MS is ${REFERENCE_MS} ms`);
    expect(FORMULA).toContain(`benchmarkIndex of ${DERIVATION.benchmarkIndex}`);
    expect(FORMULA).toContain(`that host's ${DERIVATION.rawMs} ms`);
  });
});

describe("calibratedSlowdown", () => {
  it("is REFERENCE_MS over the host's raw time, rounded to one decimal", () => {
    expect(calibratedSlowdown(REFERENCE_MS / 4)).toBe(4);
    expect(calibratedSlowdown(REFERENCE_MS / 3.44)).toBe(3.4);
    expect(calibratedSlowdown(REFERENCE_MS / 3.46)).toBe(3.5);
    expect(calibratedSlowdown(REFERENCE_MS / 14.26)).toBe(14.3);
  });

  it("accepts the bounds themselves, after rounding", () => {
    expect(calibratedSlowdown(REFERENCE_MS)).toBe(MIN_MULTIPLIER);
    expect(calibratedSlowdown(REFERENCE_MS / 0.96)).toBe(MIN_MULTIPLIER);
    expect(calibratedSlowdown(REFERENCE_MS / MAX_MULTIPLIER)).toBe(MAX_MULTIPLIER);
    expect(calibratedSlowdown(REFERENCE_MS / 20.04)).toBe(MAX_MULTIPLIER);
  });

  it("stops, naming the time and the range, on a host slower than the reference device or too fast for 20x", () => {
    const range = new RegExp(`1x to 20x \\(about ${Math.round(REFERENCE_MS / 20)} to ${REFERENCE_MS} ms, against a reference of ${REFERENCE_MS} ms\\)`);
    expect(() => calibratedSlowdown(REFERENCE_MS * 1.1)).toThrow(/calibrates to 0\.9x/);
    expect(() => calibratedSlowdown(REFERENCE_MS * 1.1)).toThrow(range);
    expect(() => calibratedSlowdown(REFERENCE_MS / 21)).toThrow(/calibrates to 21x; the gate accepts/);
    expect(() => calibratedSlowdown(REFERENCE_MS / 21)).toThrow(range);
  });

  it("stops on a time that is not a positive number", () => {
    for (const rawMs of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calibratedSlowdown(rawMs), String(rawMs)).toThrow(/calibrates to no multiplier/);
    }
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
