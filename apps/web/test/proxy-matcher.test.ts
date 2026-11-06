import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import { describe, expect, it } from "vitest";

import { decidePath } from "../lib/path-decision";
import { MAX_PAGE_PATH_LENGTH, OWN_ROUTE_PATHS, pagePath, resourcePath, ROOT_PATH } from "../lib/routes";
import { config } from "../proxy";

/**
 * The proxy's matcher, compiled as Next.js compiles it for the build
 * manifest (`tryToParsePath`) and tested as the router tests it at runtime
 * (`getMiddlewareRouteMatcher`, a flagless `RegExp`): it must reach every
 * request `lib/path-decision.ts` could redirect or answer with a 404, and
 * no canonical page path, so an ISR hit for a page never pays for the
 * proxy, nor does the favicon every browser asks for, the revalidate route
 * or a framework asset.
 */

const matchers = (config.matcher as string[]).map((source) => {
  const parsed = tryToParsePath(source);
  if (parsed.error || parsed.regexStr === undefined) throw parsed.error ?? new Error(`cannot parse ${source}`);
  return { regexp: parsed.regexStr, originalSource: source };
});
const matches = getMiddlewareRouteMatcher(matchers);
const proxied = (path: string): boolean => matches(path, {} as never, {});

/** The matcher reaches `path` whenever the decision would act on it. */
function expectReached(path: string): void {
  if (decidePath(path) !== null) {
    expect(proxied(path), `${path} is decided by the proxy, so the matcher must reach it`).toBe(true);
  }
}

describe("the proxy's matcher", () => {
  it("never matches a canonical page path, the root included", () => {
    for (const segments of [[], ["about"], ["about", "team"], ["company", "contact"], ["resourcesx"], ["apiary"], ["a-b_c~e", "x1"], ["a".repeat(200)]]) {
      const path = pagePath(segments);
      expect(decidePath(path), path).toBeNull();
      expect(proxied(path), path).toBe(false);
    }
  });

  it("never matches the front end's own routes outside the library: the favicon and the revalidate route", () => {
    for (const path of [...OWN_ROUTE_PATHS, "/api/revalidate"]) {
      expect(decidePath(path), path).toBeNull();
      expect(proxied(path), path).toBe(false);
    }
  });

  it("matches every /resources/** path, canonical or not, for the page/1 rule and the library's shapes", () => {
    for (const path of [ROOT_PATH + "resources/", "/resources/page/1/", resourcePath("webinar", "example"), "/resources/Webinar/", "/resources/topic/%e6%97%a5/", "/resources/topic/", "/resources/page/x/", "/resources/a/b/c/"]) {
      expect(proxied(path), path).toBe(true);
    }
  });

  it("matches every other path with an upper-case letter, a percent escape or a repeated slash: the redirects", () => {
    for (const path of ["/About/", "/about/Team/", "/%41bout/", "/x%E6%97%A5/", "/%D0%94%D0%BE%D0%BC/", "/about//team/", "/Resources/", "/RESOURCES/webinar/", "/Favicon.ICO"]) {
      expect(decidePath(path), path).not.toBeNull();
      expect(proxied(path), path).toBe(true);
    }
  });

  it("matches every path the catch-all would answer with a 404 without a request: a dot, a long segment, a reserved segment, the cap", () => {
    for (const path of ["/robots.txt", "/wp-login.php", "/.env", "/wp-admin/install.php", "/favicon.icox", "/favicon.ico.bak", "/about/team.html", "/api/", "/api/other/", "/api/Revalidate/", "/api/revalidate/x/", "/api/revalidatex/", `/${"a".repeat(201)}/`, `/about/${"b".repeat(201)}/x/`]) {
      expect(decidePath(path), path).toEqual({ kind: "not-found" });
      expect(proxied(path), path).toBe(true);
    }
    const segment = "a".repeat(200);
    const tooLong = pagePath(Array.from({ length: Math.ceil(MAX_PAGE_PATH_LENGTH / 201) + 1 }, () => segment));
    expect(decidePath(tooLong)).toEqual({ kind: "not-found" });
    expect(proxied(tooLong)).toBe(true);
    // Exactly at the cap, in segments a page could have: a lookup, and no proxy.
    const atCap = pagePath([...Array.from({ length: 9 }, () => segment), "b".repeat(199)]);
    expect(atCap.length).toBe(MAX_PAGE_PATH_LENGTH);
    expect(decidePath(atCap)).toBeNull();
    expect(proxied(atCap)).toBe(false);
    // One over: the decision says 404, and the matcher reaches it on length alone.
    const overCap = pagePath(Array.from({ length: 10 }, () => segment));
    expect(overCap.length).toBe(MAX_PAGE_PATH_LENGTH + 1);
    expect(decidePath(overCap)).toEqual({ kind: "not-found" });
    expect(proxied(overCap)).toBe(true);
  });

  it("never matches the framework's assets or the uploads rewrite, whatever follows", () => {
    for (const path of ["/_next/static/chunks/Abc.js", "/_next/image", "/_next/junk/", "/media/2026/11/Diagram.PNG", "/media/x%20y.png", "/media/x/"]) {
      expect(decidePath(path), path).toBeNull();
      expect(proxied(path), path).toBe(false);
    }
  });

  it("matches every path the decision would act on, over the characters a path can hold", () => {
    for (let code = 0x20; code <= 0x7e; code += 1) {
      const character = String.fromCharCode(code);
      for (const raw of [`/a${character}b/`, `/a${encodeURIComponent(character)}b/`, `/x/a${character}b/`]) {
        let path: string;
        try {
          path = new URL(raw, "http://localhost").pathname;
        } catch {
          continue;
        }
        expectReached(path);
      }
    }
  });

  it("matches every path the decision would act on, over the shapes a library path can take", () => {
    const parts = ["webinar", "topic", "page", "2", "x", "a.b", "A", "%e6%97%a5", "a".repeat(201)];
    for (const a of parts) {
      for (const b of parts) {
        for (const c of ["", "page/2/", "x/", "topic/x/"]) {
          expectReached(`/resources/${a}/${b}/${c}`);
          expectReached(`/${a}/${b}/${c}`);
        }
      }
    }
  });
});
