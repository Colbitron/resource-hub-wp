import { describe, expect, it } from "vitest";

import { shard } from "../e2e/lighthouse-shard.mts";

// The URLs one CI Lighthouse job measures (e2e/lighthouse-shard.mts).

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
