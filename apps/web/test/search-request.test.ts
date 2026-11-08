import { describe, expect, it } from "vitest";

import { parseSearchRequest } from "../lib/search-request";

/**
 * The search page's request, read from its query string before any request
 * (issue #115): which state each `q` and `page` gives, and that a query the
 * plugin's route would refuse, or a page it would refuse, never becomes a
 * request.
 */
describe("parseSearchRequest", () => {
  it("is the form alone with no q, an empty q or a q of whitespace", () => {
    expect(parseSearchRequest({})).toEqual({ kind: "none", input: "" });
    expect(parseSearchRequest({ q: "" })).toEqual({ kind: "none", input: "" });
    expect(parseSearchRequest({ q: " \t  " })).toEqual({ kind: "none", input: " \t  " });
    expect(parseSearchRequest({ q: [] })).toEqual({ kind: "none", input: "" });
  });

  it("searches page 1 for the normalised query and keeps the visitor's own words for the form", () => {
    expect(parseSearchRequest({ q: "  core   web\tvitals " })).toEqual({ kind: "search", input: "  core   web\tvitals ", query: "core web vitals", page: 1 });
  });

  it("is too short under 2 code points and too long over 100, counted once normalised", () => {
    expect(parseSearchRequest({ q: "a" })).toMatchObject({ kind: "too-short", input: "a" });
    expect(parseSearchRequest({ q: "  a  " })).toMatchObject({ kind: "too-short" });
    // One astral code point is two UTF-16 units and still one character.
    expect(parseSearchRequest({ q: "\u{1F50D}" })).toMatchObject({ kind: "too-short" });
    expect(parseSearchRequest({ q: "ab" })).toMatchObject({ kind: "search", query: "ab" });
    expect(parseSearchRequest({ q: "a".repeat(100) })).toMatchObject({ kind: "search" });
    expect(parseSearchRequest({ q: "\u{1F50D}".repeat(100) })).toMatchObject({ kind: "search" });
    expect(parseSearchRequest({ q: "a".repeat(101) })).toMatchObject({ kind: "too-long" });
    // Whitespace collapses before the count, so a long run of spaces between two words is short.
    expect(parseSearchRequest({ q: `a${" ".repeat(200)}b` })).toMatchObject({ kind: "search", query: "a b" });
  });

  it("takes the first value of a parameter given twice", () => {
    expect(parseSearchRequest({ q: ["first", "second"], page: ["2", "3"] })).toMatchObject({ kind: "search", query: "first", page: 2 });
  });

  it("reads a canonical page from 1 to 10", () => {
    for (let page = 1; page <= 10; page++) {
      expect(parseSearchRequest({ q: "ab", page: String(page) })).toMatchObject({ kind: "search", page });
    }
    expect(parseSearchRequest({ q: "ab", page: "" })).toMatchObject({ kind: "search", page: 1 });
  });

  it("answers any other page with the no-such-page state and no request: past 10, zero, signed, padded, fractional, not a number", () => {
    for (const page of ["0", "11", "100", "-1", "+2", "02", "1.5", "1e1", " 2", "x", "２"]) {
      expect(parseSearchRequest({ q: "ab", page }), page).toEqual({ kind: "no-such-page", input: "ab", query: "ab", page });
    }
  });

  it("judges the query before the page, so a bad query with a bad page is the query's message", () => {
    expect(parseSearchRequest({ q: "a", page: "99" })).toMatchObject({ kind: "too-short" });
    expect(parseSearchRequest({ page: "2" })).toMatchObject({ kind: "none" });
  });
});
