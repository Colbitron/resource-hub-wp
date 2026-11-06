import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import { describe, expect, it } from "vitest";

import { canonicalPath } from "../lib/canonical-path";
import { pagePath, resourcePath, ROOT_PATH } from "../lib/routes";
import { config } from "../proxy";

/**
 * The proxy's matcher, compiled as Next.js compiles it for the build
 * manifest (`tryToParsePath`) and tested as the router tests it at runtime
 * (`getMiddlewareRouteMatcher`, a flagless `RegExp`): it must reach every
 * request `lib/canonical-path.ts` could redirect and no canonical page
 * path, so an ISR hit for a page never pays for the proxy.
 */

const matchers = (config.matcher as string[]).map((source) => {
  const parsed = tryToParsePath(source);
  if (parsed.error || parsed.regexStr === undefined) throw parsed.error ?? new Error(`cannot parse ${source}`);
  return { regexp: parsed.regexStr, originalSource: source };
});
const matches = getMiddlewareRouteMatcher(matchers);
const proxied = (path: string): boolean => matches(path, {} as never, {});

describe("the proxy's matcher", () => {
  it("never matches a canonical page path, the root included", () => {
    for (const segments of [[], ["about"], ["about", "team"], ["company", "contact"], ["resourcesx"], ["a-b_c~e", "x1"]]) {
      const path = pagePath(segments);
      expect(canonicalPath(path), path).toBeNull();
      expect(proxied(path), path).toBe(false);
    }
    expect(proxied("/favicon.ico")).toBe(false);
    expect(proxied("/robots.txt")).toBe(false);
  });

  it("matches every /resources/** path, canonical or not, for the page/1 rule", () => {
    for (const path of [ROOT_PATH + "resources/", "/resources/page/1/", resourcePath("webinar", "example"), "/resources/Webinar/", "/resources/topic/%e6%97%a5/"]) {
      expect(proxied(path), path).toBe(true);
    }
  });

  it("matches every other path with an upper-case letter, a percent escape or a repeated slash", () => {
    for (const path of ["/About/", "/about/Team/", "/%41bout/", "/x%E6%97%A5/", "/%D0%94%D0%BE%D0%BC/", "/about//team/", "/Resources/", "/RESOURCES/webinar/"]) {
      expect(canonicalPath(path), path).not.toBeNull();
      expect(proxied(path), path).toBe(true);
    }
  });

  it("never matches the front end's own first segments, whatever follows", () => {
    for (const path of ["/_next/static/chunks/Abc.js", "/_next/image", "/api/revalidate/", "/api/Revalidate/", "/media/2026/11/Diagram.PNG", "/media/x%20y.png"]) {
      expect(proxied(path), path).toBe(false);
    }
  });

  it("matches every path canonicalPath would redirect, over the characters a path can hold", () => {
    for (let code = 0x20; code <= 0x7e; code += 1) {
      const character = String.fromCharCode(code);
      for (const path of [`/a${character}b/`, `/a${encodeURIComponent(character)}b/`]) {
        let canonical: string | null;
        try {
          canonical = canonicalPath(new URL(path, "http://localhost").pathname);
        } catch {
          continue;
        }
        if (canonical !== null) {
          expect(proxied(new URL(path, "http://localhost").pathname), path).toBe(true);
        }
      }
    }
  });
});
