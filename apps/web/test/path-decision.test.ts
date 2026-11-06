import { describe, expect, it } from "vitest";

import { decidePath, isNotFoundPath, NOT_FOUND_ROUTE } from "../lib/path-decision";
import {
  listingPath,
  MAX_PAGE_PATH_LENGTH,
  OWN_ROUTE_PATHS,
  pagePath,
  RESERVED_ROOT_SEGMENTS,
  resourcePath,
  ROOT_PATH,
  topicListingPath,
  typeTopicListingPath,
} from "../lib/routes";

/**
 * What the proxy answers from the path alone (issue #46): a 404 for a path
 * no route could answer with anything else, a redirect for a non-canonical
 * path, and nothing for everything a route must decide. The 404s here are
 * exactly the ones the routes decide without a request, through the same
 * functions, so the checks mirror `test/page-request.test.ts`,
 * `test/redirects.test.ts` and the listing's validation.
 */

const SLUGS = ["webinar", "a11y", "case-study", "x1", "a-b_c~e", "%e6%97%a5", "%d0%b4%d0%be%d0%bc", "arti%2fcle", "a%20b"];

describe("isNotFoundPath", () => {
  it("is false for the root and for every canonical page path", () => {
    expect(isNotFoundPath(ROOT_PATH)).toBe(false);
    for (const segments of [["about"], ["about", "team"], ["company", "contact"], ["resourcesx"], ["apiary"], ["a-b_c~e", "x1"], ["%e6%97%a5"], ["nowhere"]]) {
      expect(isNotFoundPath(pagePath(segments)), segments.join("/")).toBe(false);
    }
  });

  it("is false for every listing and resource path a builder makes", () => {
    for (const type of SLUGS) {
      for (const topic of SLUGS) {
        for (const page of [1, 2, 12]) {
          for (const path of [listingPath({}, page), listingPath({ type }, page), topicListingPath(topic, page), typeTopicListingPath(type, topic, page)]) {
            expect(isNotFoundPath(path), path).toBe(false);
          }
        }
        expect(isNotFoundPath(resourcePath(type, topic)), resourcePath(type, topic)).toBe(false);
      }
    }
    // A resource whose slug is a reserved word is a lookup, not a 404: only type slugs are reserved.
    expect(isNotFoundPath("/resources/webinar/topic/")).toBe(false);
    expect(isNotFoundPath("/resources/webinar/page/")).toBe(false);
  });

  it("is false for the front end's own routes and for everything under /_next/ and /media/, which it leaves to the framework and the rewrite", () => {
    for (const path of [...OWN_ROUTE_PATHS, "/api/revalidate", "/favicon.ico/"]) {
      expect(isNotFoundPath(path), path).toBe(false);
    }
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/_next/junk/", "/media/2026/11/diagram.png", "/media/x/", "/Media/X.PNG"]) {
      expect(isNotFoundPath(path), path).toBe(false);
    }
  });

  it("is true for a page path the catch-all answers with a 404 without a request: a dot, a non-slug, a reserved first segment, the cap", () => {
    for (const path of [
      "/robots.txt",
      "/wp-login.php",
      "/.env",
      "/wp-admin/install.php",
      "/favicon.icox",
      "/about/team.html",
      "/api/",
      "/api/other/",
      "/api/Revalidate/",
      "/api/revalidate/x/",
      "/resourcesx/.git/",
      `/${"a".repeat(201)}/`,
      "/%2e/",
    ]) {
      expect(isNotFoundPath(path), path).toBe(true);
    }
    const segment = "a".repeat(200);
    const tooLong = Array.from({ length: Math.ceil(MAX_PAGE_PATH_LENGTH / 201) + 1 }, () => segment);
    expect(pagePath(tooLong).length).toBeGreaterThan(MAX_PAGE_PATH_LENGTH);
    expect(isNotFoundPath(pagePath(tooLong))).toBe(true);
    // Exactly at the cap is a lookup.
    const atCap = [...Array.from({ length: 9 }, () => segment), "b".repeat(199)];
    expect(pagePath(atCap).length).toBe(MAX_PAGE_PATH_LENGTH);
    expect(isNotFoundPath(pagePath(atCap))).toBe(false);
    // An escape Next.js leaves alone in params is part of a slug WordPress could store: a lookup.
    expect(isNotFoundPath("/a%2fb/")).toBe(false);
  });

  it("is true for a library path no listing or resource route has", () => {
    for (const path of [
      "/resources/topic/",
      "/resources/page/",
      "/resources/webinar/x/y/",
      "/resources/webinar/topic/a11y/x/",
      "/resources/topic/a11y/x/",
      "/resources/topic/a11y/page/2/x/",
      "/resources/webinar/topic/a11y/page/2/x/",
      "/resources/a/b/c/d/e/f/",
    ]) {
      expect(isNotFoundPath(path), path).toBe(true);
    }
  });

  it("is true for a listing whose segments the listing refuses, as the listing's own validation says", () => {
    for (const path of [
      "/resources/page/x/",
      "/resources/page/0/",
      "/resources/page/01/",
      "/resources/page/1.5/",
      "/resources/webinar/page/x/",
      "/resources/topic/a11y/page/x/",
      "/resources/webinar/topic/a11y/page/0/",
      "/resources/topic/topic/x/",
      "/resources/page/page/2/",
      "/resources/topic/page/2/",
      `/resources/${"a".repeat(201)}/`,
      `/resources/topic/${"a".repeat(201)}/`,
      "/resources/case%2dstudy/",
    ]) {
      expect(isNotFoundPath(path), path).toBe(true);
    }
    // `/page/1/` is the proxy's redirect, decided before this on the canonical form; here it is a plain page segment and refused.
    expect(isNotFoundPath("/resources/page/1/")).toBe(true);
  });

  it("is true for a resource whose type or slug segment is not one, as the resource page's own first check says", () => {
    for (const path of [`/resources/webinar/${"a".repeat(201)}/`, "/resources/webinar/case%2dstudy/", "/resources/topic/page/x/"]) {
      expect(isNotFoundPath(path), path).toBe(true);
    }
  });

  it("agrees with the reserved segments list", () => {
    for (const segment of RESERVED_ROOT_SEGMENTS) {
      if (segment === "resources") continue;
      // Reserved and not ours to answer, or reserved and a 404: never a page either way.
      const path = `/${segment}/x/`;
      expect(isNotFoundPath(path), path).toBe(segment === "api");
    }
  });
});

describe("decidePath", () => {
  it("is null for a canonical path, the root and the front end's own routes", () => {
    for (const path of [ROOT_PATH, "/about/", "/about/team/", "/resources/", "/resources/webinar/example/", "/resources/topic/%e6%97%a5/page/2/", ...OWN_ROUTE_PATHS, "/_next/junk/", "/media/x/"]) {
      expect(decidePath(path), path).toBeNull();
    }
  });

  it("redirects a non-canonical path that could be a page or a listing", () => {
    expect(decidePath("/About/Team/")).toEqual({ kind: "redirect", path: "/about/team/" });
    expect(decidePath("/resources/Webinar/")).toEqual({ kind: "redirect", path: "/resources/webinar/" });
    expect(decidePath("/resources/page/1/")).toEqual({ kind: "redirect", path: "/resources/" });
    expect(decidePath("/Resources/Page/1/")).toEqual({ kind: "redirect", path: "/resources/" });
    expect(decidePath("/%D0%94%D0%BE%D0%BC/")).toEqual({ kind: "redirect", path: "/%d0%b4%d0%be%d0%bc/" });
    expect(decidePath("/Favicon.ICO")).toEqual({ kind: "redirect", path: "/favicon.ico" });
  });

  it("answers a 404 on the canonical form, before any redirect, so a path that cannot be a page costs no hop", () => {
    for (const path of ["/robots.txt", "/Robots.TXT", "/api/other/", "/Api/Other/", "/resources/Page/X/", "/Resources/topic/", "/.env", `/${"a".repeat(201)}/`]) {
      expect(decidePath(path), path).toEqual({ kind: "not-found" });
    }
  });

  it("rewrites to the App Router's prerendered not-found route", () => {
    expect(NOT_FOUND_ROUTE).toBe("/_not-found");
  });
});
