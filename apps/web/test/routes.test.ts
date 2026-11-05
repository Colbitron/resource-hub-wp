import { describe, expect, it } from "vitest";

import {
  RESERVED_TYPE_SLUGS,
  isPageNumber,
  isReservedTypeSlug,
  isSlug,
  isTypeSlug,
  libraryPath,
  listingPath,
  parsePageSegment,
  resourcePath,
  topicListingPath,
  typeListingPath,
  typeTopicListingPath,
} from "../lib/routes";

describe("reserved type slugs", () => {
  it("are topic and page", () => {
    expect(RESERVED_TYPE_SLUGS).toEqual(["topic", "page"]);
    expect(isReservedTypeSlug("topic")).toBe(true);
    expect(isReservedTypeSlug("page")).toBe(true);
    expect(isReservedTypeSlug("webinar")).toBe(false);
    expect(isReservedTypeSlug("Topic")).toBe(false);
  });
});

describe("isSlug", () => {
  it("accepts WordPress slugs, percent-encoded ones included", () => {
    expect(isSlug("example")).toBe(true);
    expect(isSlug("core-web-vitals-2026")).toBe(true);
    expect(isSlug("%e6%97%a5%e6%9c%ac")).toBe(true);
    expect(isSlug("日本")).toBe(true);
    expect(isSlug("topic")).toBe(true);
  });

  it("rejects what the schema rejects: empty, slash, whitespace, over 200 characters", () => {
    expect(isSlug("")).toBe(false);
    expect(isSlug("a/b")).toBe(false);
    expect(isSlug("a b")).toBe(false);
    expect(isSlug("a\tb")).toBe(false);
    expect(isSlug("a".repeat(200))).toBe(true);
    expect(isSlug("a".repeat(201))).toBe(false);
  });

  it("counts characters, not UTF-16 units, as the schema does", () => {
    expect(isSlug("😀".repeat(200))).toBe(true);
    expect(isSlug("😀".repeat(201))).toBe(false);
  });

  it("rejects dot segments and malformed Unicode", () => {
    for (const dots of [".", "..", "%2e", "%2E%2e", ".%2e"]) {
      expect(isSlug(dots)).toBe(false);
    }
    expect(isSlug("...")).toBe(true);
    expect(isSlug("a\ud800b")).toBe(false);
  });
});

describe("isTypeSlug", () => {
  it("is a slug that is not reserved", () => {
    expect(isTypeSlug("webinar")).toBe(true);
    expect(isTypeSlug("topic")).toBe(false);
    expect(isTypeSlug("page")).toBe(false);
    expect(isTypeSlug("")).toBe(false);
    expect(isTypeSlug("a/b")).toBe(false);
  });
});

describe("isPageNumber", () => {
  it("accepts safe integers from 1", () => {
    expect(isPageNumber(1)).toBe(true);
    expect(isPageNumber(2)).toBe(true);
    expect(isPageNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("rejects zero, negatives, fractions, NaN, Infinity and unsafe integers", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isPageNumber(bad)).toBe(false);
    }
  });
});

describe("parsePageSegment", () => {
  it("reads canonical page numbers from 2", () => {
    expect(parsePageSegment("2")).toBe(2);
    expect(parsePageSegment("10")).toBe(10);
    expect(parsePageSegment(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects page 1, which is the listing's own path", () => {
    expect(parsePageSegment("1")).toBeNull();
  });

  it("rejects every non-canonical or bad form", () => {
    for (const bad of [
      "",
      "0",
      "00",
      "02",
      "-2",
      "+2",
      "2.0",
      "1e3",
      "0x10",
      " 2",
      "2 ",
      "two",
      "٢",
      "9007199254740992",
      "99999999999999999999",
    ]) {
      expect(parsePageSegment(bad), bad).toBeNull();
    }
  });
});

describe("listing paths", () => {
  it("builds the library", () => {
    expect(libraryPath()).toBe("/resources/");
    expect(listingPath()).toBe("/resources/");
    expect(listingPath({})).toBe("/resources/");
  });

  it("builds a type listing", () => {
    expect(typeListingPath("webinar")).toBe("/resources/webinar/");
    expect(listingPath({ type: "webinar" })).toBe("/resources/webinar/");
  });

  it("builds a topic listing", () => {
    expect(topicListingPath("performance")).toBe("/resources/topic/performance/");
    expect(listingPath({ topic: "performance" })).toBe("/resources/topic/performance/");
  });

  it("allows topic slugs that are reserved words for types", () => {
    expect(topicListingPath("topic")).toBe("/resources/topic/topic/");
    expect(topicListingPath("page")).toBe("/resources/topic/page/");
  });

  it("builds a type plus topic listing", () => {
    expect(typeTopicListingPath("webinar", "performance")).toBe(
      "/resources/webinar/topic/performance/",
    );
    expect(listingPath({ type: "webinar", topic: "performance" })).toBe(
      "/resources/webinar/topic/performance/",
    );
  });

  it("adds page/{n}/ from page 2, and nothing for page 1", () => {
    expect(libraryPath(1)).toBe("/resources/");
    expect(libraryPath(2)).toBe("/resources/page/2/");
    expect(typeListingPath("webinar", 3)).toBe("/resources/webinar/page/3/");
    expect(topicListingPath("performance", 4)).toBe("/resources/topic/performance/page/4/");
    expect(typeTopicListingPath("webinar", "performance", 5)).toBe(
      "/resources/webinar/topic/performance/page/5/",
    );
  });

  it("throws on a bad page number", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(() => libraryPath(bad)).toThrow(RangeError);
    }
  });

  it("throws on a reserved or invalid type slug", () => {
    expect(() => typeListingPath("topic")).toThrow(RangeError);
    expect(() => typeListingPath("page")).toThrow(RangeError);
    expect(() => typeTopicListingPath("page", "performance")).toThrow(RangeError);
    expect(() => typeListingPath("")).toThrow(RangeError);
    expect(() => typeListingPath("a/b")).toThrow(RangeError);
    expect(() => typeListingPath("..")).toThrow(RangeError);
  });

  it("throws on an invalid topic slug", () => {
    expect(() => topicListingPath("")).toThrow(RangeError);
    expect(() => topicListingPath("a b")).toThrow(RangeError);
  });
});

describe("resourcePath", () => {
  it("builds /resources/{type}/{slug}/", () => {
    expect(resourcePath("webinar", "example")).toBe("/resources/webinar/example/");
  });

  it("allows resource slugs topic and page, which are only reserved for types", () => {
    expect(resourcePath("webinar", "page")).toBe("/resources/webinar/page/");
    expect(resourcePath("webinar", "topic")).toBe("/resources/webinar/topic/");
  });

  it("throws on a reserved type, or an invalid type or slug", () => {
    expect(() => resourcePath("topic", "example")).toThrow(RangeError);
    expect(() => resourcePath("page", "example")).toThrow(RangeError);
    expect(() => resourcePath("webinar", "")).toThrow(RangeError);
    expect(() => resourcePath("webinar", "a/b")).toThrow(RangeError);
    expect(() => resourcePath("webinar", ".")).toThrow(RangeError);
  });
});

describe("segment encoding", () => {
  it("keeps WordPress's percent-encoded slugs as they are, never double-encoding", () => {
    expect(resourcePath("webinar", "%e6%97%a5%e6%9c%ac")).toBe(
      "/resources/webinar/%e6%97%a5%e6%9c%ac/",
    );
  });

  it("keeps the characters a path segment allows", () => {
    expect(resourcePath("webinar", "a-b_c.d~e!$&'()*+,;=:@")).toBe(
      "/resources/webinar/a-b_c.d~e!$&'()*+,;=:@/",
    );
  });

  it("escapes characters a path segment does not allow", () => {
    expect(resourcePath("webinar", "a?b#c")).toBe("/resources/webinar/a%3Fb%23c/");
    expect(resourcePath("webinar", "100%")).toBe("/resources/webinar/100%25/");
    expect(resourcePath("webinar", "%zz")).toBe("/resources/webinar/%25zz/");
    expect(resourcePath("webinar", "a\\b")).toBe("/resources/webinar/a%5Cb/");
    expect(topicListingPath("日本")).toBe("/resources/topic/%E6%97%A5%E6%9C%AC/");
  });
});
