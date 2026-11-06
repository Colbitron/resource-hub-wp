import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";

import { PAGES_ROUTE_SOURCE, RESOURCE_ROUTE_SOURCE, REVALIDATE_EACH_TIME, routeHeaders } from "./route-headers";
import {
  libraryPath,
  pagePath,
  RESERVED_ROOT_SEGMENTS,
  resourcePath,
  ROOT_PATH,
  topicListingPath,
  typeListingPath,
  typeTopicListingPath,
} from "./routes";

/**
 * Each rule's source is compiled with the matcher Next.js compiles a
 * `headers()` source with (`getPathMatch`: path-to-regexp with `/` as the
 * delimiter, not strict, not case-sensitive), so what this checks is what
 * the router matches. The wire effect, on the real routes under
 * `next start`, is `e2e/resource-page.spec.ts`'s and `e2e/pages.spec.ts`'s.
 */
function matcher(source: string): (path: string) => boolean {
  const match = getPathMatch(source);
  return (path) => match(path) !== false;
}

const LISTINGS = [
  libraryPath(),
  typeListingPath("webinar"),
  topicListingPath("accessibility"),
  typeTopicListingPath("webinar", "accessibility"),
  "/resources/page/2/",
  "/resources/webinar/page/2/",
  "/resources/topic/accessibility/page/2/",
  "/resources/webinar/topic/accessibility/page/2/",
  "/resources/topic/",
  "/resources/page/",
];

describe("routeHeaders", () => {
  it("is one Cache-Control rule for the resource route and one for the pages catch-all, and nothing else", () => {
    expect(routeHeaders()).toEqual([
      { source: RESOURCE_ROUTE_SOURCE, headers: [{ key: "Cache-Control", value: REVALIDATE_EACH_TIME }] },
      { source: PAGES_ROUTE_SOURCE, headers: [{ key: "Cache-Control", value: REVALIDATE_EACH_TIME }] },
    ]);
  });

  it("tells a browser to ask again every time, without forbidding a shared cache", () => {
    const directives = REVALIDATE_EACH_TIME.split(",").map((directive) => directive.trim());
    expect(directives).toContain("max-age=0");
    expect(directives).toContain("must-revalidate");
    expect(directives).not.toContain("no-store");
    expect(directives.some((directive) => directive.startsWith("s-maxage"))).toBe(false);
  });
});

describe("the resource route's source", () => {
  const matches = matcher(RESOURCE_ROUTE_SOURCE);

  it("matches every resource path the builders produce, with or without the trailing slash", () => {
    for (const [type, slug] of [
      ["webinar", "example"],
      ["topics", "a-type-called-topics"],
      ["pages", "a-type-called-pages"],
      ["article", "%e6%97%a5%e6%9c%ac"],
      ["x", "a".repeat(200)],
    ]) {
      const path = resourcePath(type, slug);
      expect(matches(path), path).toBe(true);
      expect(matches(path.slice(0, -1)), path).toBe(true);
    }
    // Next.js matches sources without regard to case, so the proxy's mixed-case 308 is matched too.
    expect(matches("/resources/Webinar/Example/")).toBe(true);
  });

  it("matches no listing, so the listings keep Next.js's ISR header", () => {
    for (const path of LISTINGS) {
      expect(matches(path), path).toBe(false);
    }
  });

  it("matches nothing outside /resources/", () => {
    for (const path of [ROOT_PATH, "/about/team/", "/api/revalidate/", "/media/2026/11/a.png", "/fixtures/redirect/webinar/x/"]) {
      expect(matches(path), path).toBe(false);
    }
  });
});

describe("the pages catch-all's source", () => {
  const matches = matcher(PAGES_ROUTE_SOURCE);

  it("matches the root and every page path the builder produces, with or without the trailing slash", () => {
    for (const segments of [[], ["about"], ["about", "team"], ["home"], ["resourcesx"], ["apiary"], ["a".repeat(200), "b"]]) {
      const path = pagePath(segments);
      expect(matches(path), path).toBe(true);
      if (path !== ROOT_PATH) {
        expect(matches(path.slice(0, -1)), path).toBe(true);
      }
    }
    // The paths the catch-all answers without a request are matched too; a stored 404 is still a stored response.
    for (const path of ["/About/Team/", "/robots.txt", "/sitemap.xml", "/-/"]) {
      expect(matches(path), path).toBe(true);
    }
  });

  it("matches no path under the front end's own first segments, as the catch-all never serves one", () => {
    for (const segment of RESERVED_ROOT_SEGMENTS) {
      for (const path of [`/${segment}/`, `/${segment}`, `/${segment}/anything/`, `/${segment}/a/b.png`]) {
        expect(matches(path), path).toBe(false);
      }
    }
    for (const path of [...LISTINGS, resourcePath("webinar", "example"), "/api/revalidate/", "/media/2026/11/a.png", "/_next/static/chunks/a.js", "/_next/image"]) {
      expect(matches(path), path).toBe(false);
    }
  });
});
