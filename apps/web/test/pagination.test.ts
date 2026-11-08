import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AROUND, MAX_LISTED, pageWindow, type PageItem } from "../lib/pagination";

/**
 * The contract's page-window table: every page count from 1 to 12 and every
 * current page, with the items `pageWindow()` lists. The CMS's
 * `PaginationNumbersTest` reads the same file, so a CMS collection page and
 * the front end list the same numbers, and a change to either side's
 * windowing fails one of the two until the fixture, and the other side,
 * follow.
 */
interface PageWindowFixture {
  readonly maxListed: number;
  readonly around: number;
  readonly cases: ReadonlyArray<{ readonly pages: number; readonly current: number; readonly items: PageItem[] }>;
}

const fixture: PageWindowFixture = JSON.parse(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/ui/fixtures/pagination/page-window.json"), "utf8"),
);

describe("pageWindow", () => {
  it("lists what the contract's fixture lists, for every page count up to 12 and every current page", () => {
    expect(fixture.maxListed).toBe(MAX_LISTED);
    expect(fixture.around).toBe(AROUND);
    expect(fixture.cases.length).toBeGreaterThan(0);
    for (const { pages, current, items } of fixture.cases) {
      expect(pageWindow(current, pages), `${current} of ${pages}`).toEqual(items);
    }
    // The table is complete: one case per (pages, current) pair, 1..12.
    const keys = fixture.cases.map(({ pages, current }) => `${pages}:${current}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (let pages = 1; pages <= 12; pages++) {
      for (let current = 1; current <= pages; current++) {
        expect(keys, `${current} of ${pages} is in the fixture`).toContain(`${pages}:${current}`);
      }
    }
  });

  it("lists every page up to the maximum", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 2)).toEqual([1, 2]);
    expect(pageWindow(4, MAX_LISTED)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("windows a longer list around the current page with the ends kept", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, null, 20]);
    expect(pageWindow(2, 20)).toEqual([1, 2, 3, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(19, 20)).toEqual([1, null, 18, 19, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 19, 20]);
  });

  it("never uses a gap for a single page", () => {
    // Page 2 and page 19 would each be a gap of one: they are listed instead.
    expect(pageWindow(4, 20)).toEqual([1, 2, 3, 4, 5, null, 20]);
    expect(pageWindow(17, 20)).toEqual([1, null, 16, 17, 18, 19, 20]);
    expect(pageWindow(3, 8)).toEqual([1, 2, 3, 4, null, 8]);
  });

  it("has a bounded length, strictly increasing numbers and the current page", () => {
    for (let total = 1; total <= 40; total++) {
      for (let current = 1; current <= total; current++) {
        const items = pageWindow(current, total);
        expect(items.length).toBeLessThanOrEqual(2 * AROUND + 5);
        expect(items).toContain(current);
        expect(items[0]).toBe(1);
        expect(items.at(-1)).toBe(total);
        const numbers = items.filter((item): item is number => item !== null);
        for (let index = 1; index < numbers.length; index++) {
          expect(numbers[index]).toBeGreaterThan(numbers[index - 1]);
        }
        // A gap always stands for at least two pages.
        items.forEach((item, index) => {
          if (item === null) {
            expect((items[index + 1] as number) - (items[index - 1] as number)).toBeGreaterThan(2);
          }
        });
      }
    }
  });

  it("refuses a page outside the count", () => {
    expect(() => pageWindow(0, 5)).toThrow(RangeError);
    expect(() => pageWindow(6, 5)).toThrow(RangeError);
    expect(() => pageWindow(1, 0)).toThrow(RangeError);
    expect(() => pageWindow(1.5, 5)).toThrow(RangeError);
  });
});
