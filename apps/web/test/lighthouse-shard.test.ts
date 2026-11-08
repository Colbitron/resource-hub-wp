import { describe, expect, it } from "vitest";

import { assertNoLocalOverrides, DEFAULT_RUNS, onlyPaths, runsPerUrl, shard } from "../e2e/lighthouse-shard.mts";

// The URLs one CI Lighthouse job measures, and the local smell test's
// settings (e2e/lighthouse-shard.mts).

const URLS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

describe("shard", () => {
  it("is every URL, in order, when no shard is named", () => {
    expect(shard(URLS, undefined)).toEqual(URLS);
    expect(shard(URLS, "")).toEqual(URLS);
  });

  it("takes every n-th URL from the i-th", () => {
    expect(shard(URLS, "1/5")).toEqual(["a", "f"]);
    expect(shard(URLS, "4/5")).toEqual(["d", "i"]);
    expect(shard(URLS, "5/5")).toEqual(["e"]);
  });

  it("measures every URL exactly once across the shards, for any count up to the list's length", () => {
    for (let total = 1; total <= URLS.length; total += 1) {
      const measured = Array.from({ length: total }, (_, index) => shard(URLS, `${index + 1}/${total}`)).flat();
      expect(measured.toSorted()).toEqual(URLS);
    }
  });

  it("fails on a shard with nothing to measure, so a matrix wider than the list is caught", () => {
    expect(() => shard(URLS, "10/10")).toThrow(/no URL to measure/);
  });

  it("fails on a shard past the count", () => {
    expect(() => shard(URLS, "6/5")).toThrow(/shard 6 of only 5/);
  });

  it.each(["0/5", "1/0", "1", "1/", "/5", "a/5", " 1/5", "1/5 ", "1.0/5", "-1/5"])("fails on %j", (spec) => {
    expect(() => shard(URLS, spec)).toThrow(/must be i\/n/);
  });
});

describe("runsPerUrl", () => {
  it("is five, CI's count, when nothing overrides it", () => {
    expect(DEFAULT_RUNS).toBe(5);
    expect(runsPerUrl(undefined)).toBe(5);
    expect(runsPerUrl("")).toBe(5);
  });

  it("reads a whole number from 1", () => {
    expect(runsPerUrl("1")).toBe(1);
    expect(runsPerUrl("3")).toBe(3);
  });

  it.each(["0", "-1", "1.5", " 1", "1 ", "one", "01"])("fails on %j", (spec) => {
    expect(() => runsPerUrl(spec)).toThrow(/must be a whole number from 1/);
  });
});

describe("onlyPaths", () => {
  const SAMPLES = [{ path: "/" }, { path: "/resources/" }, { path: "/resources/webinar/" }];

  it("is every URL when no filter is named", () => {
    expect(onlyPaths(SAMPLES, undefined)).toEqual(SAMPLES);
    expect(onlyPaths(SAMPLES, "")).toEqual(SAMPLES);
  });

  it("keeps the named paths, in the list's order", () => {
    expect(onlyPaths(SAMPLES, "/resources/")).toEqual([{ path: "/resources/" }]);
    expect(onlyPaths(SAMPLES, "/resources/webinar/,/")).toEqual([{ path: "/" }, { path: "/resources/webinar/" }]);
  });

  it.each(["/resources", "/nope/", "/,", "/, /resources/", "resources/"])("fails loudly on %j, naming the paths it accepts", (spec) => {
    expect(() => onlyPaths(SAMPLES, spec)).toThrow(/not a sampled Lighthouse URL; use comma-separated paths from \/, \/resources\/, \/resources\/webinar\//);
  });

  it("fails on a path named twice", () => {
    expect(() => onlyPaths(SAMPLES, "/,/")).toThrow(/more than once/);
  });
});

describe("assertNoLocalOverrides", () => {
  it("allows the local settings off CI", () => {
    expect(() => assertNoLocalOverrides({ RH_LIGHTHOUSE_RUNS: "1", RH_LIGHTHOUSE_URLS: "/" })).not.toThrow();
  });

  it("allows CI with neither set, and with the shard", () => {
    expect(() => assertNoLocalOverrides({ CI: "true", RH_LIGHTHOUSE_SHARD: "1/5", RH_LIGHTHOUSE_RUNS: "" })).not.toThrow();
  });

  it.each(["RH_LIGHTHOUSE_RUNS", "RH_LIGHTHOUSE_URLS"])("refuses %s in CI", (name) => {
    expect(() => assertNoLocalOverrides({ CI: "true", [name]: "1" })).toThrow(new RegExp(`${name} is a local smell-test setting`));
  });
});
