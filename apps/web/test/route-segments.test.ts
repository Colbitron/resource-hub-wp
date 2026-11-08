import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every page route's rendering model, across the whole of `app/`: each is
 * ISR, except `/search/`, the one dynamic route (ADR 0043, amended; the
 * rule is `.claude/rules/caching-and-redirects.md`). The per-route tests
 * (`listing-routes.test.ts`, `resource-route.test.ts`, `page-route.test.ts`)
 * pin each ISR route's segment config; this one walks the directory, so a
 * new page is held to the rule without being listed anywhere, and a second
 * dynamic route fails here until the ADR and the rule name it.
 *
 * "Dynamic" is read from the source, the same way the per-route tests read
 * it: a page that reads `searchParams`, calls `connection()`, `headers()` or
 * `cookies()`, or exports `dynamic`. Comments are dropped first, so prose
 * that names an API is not mistaken for a call. Test-only pages are
 * `page.fixture.tsx` (routes only under `RH_FIXTURES=1`) and are not pages
 * here.
 */

const APP = fileURLToPath(new URL("../app", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The one dynamic route, and why it may be: a search is the visitor's own words, so no query can be prerendered. */
const DYNAMIC_ROUTES = ["app/search/page.tsx"];

/** The ISR routes' interval, the literal each exports: the data layer's (`listing-routes.test.ts` checks the two are equal). */
const ROUTE_REVALIDATE = 3600;

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === "page.tsx" ? [relative(ROOT, path).split("\\").join("/")] : [];
  });
}

function source(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

/** `code` without its comments, so prose that names an API is not mistaken for a call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function isDynamic(code: string): boolean {
  return (
    /\bsearchParams\b/.test(code) ||
    /\bconnection\s*\(/.test(code) ||
    /\bheaders\s*\(/.test(code) ||
    /\bcookies\s*\(/.test(code) ||
    /^export const dynamic\b/m.test(code)
  );
}

const ALL = pages(APP);

describe("the page routes", () => {
  it("are found: the eight listings, the resource, the page catch-all and the search page", () => {
    expect(ALL).toHaveLength(11);
    expect(ALL).toEqual(expect.arrayContaining(DYNAMIC_ROUTES));
  });

  it("have one dynamic route, the search page, so a second fails here until ADR 0043 and the caching rule name it", () => {
    const dynamic = ALL.filter((file) => isDynamic(withoutComments(source(file))));
    expect(dynamic).toEqual(DYNAMIC_ROUTES);
  });

  for (const file of ALL.filter((page) => !DYNAMIC_ROUTES.includes(page))) {
    it(`${file} is ISR: revalidate = ${ROUTE_REVALIDATE} as a literal and a generateStaticParams, with no loading.tsx`, () => {
      const code = withoutComments(source(file));
      const matches = [...code.matchAll(/^export const revalidate = (.+);$/gm)];
      expect(matches.map((match) => match[1])).toEqual([String(ROUTE_REVALIDATE)]);
      expect(code).toMatch(/^export (?:async )?function generateStaticParams\(/m);
      expect(existsSync(join(ROOT, file.replace(/page\.tsx$/, "loading.tsx")))).toBe(false);
    });
  }
});

describe("the search page, the one dynamic route", () => {
  const route = withoutComments(source("app/search/page.tsx"));
  // The page's own modules: what it renders and how it reads its request.
  const modules = ["app/search/page.tsx", "components/SearchPage.tsx", "lib/search-request.ts"].map((file) => withoutComments(source(file)));

  it("is dynamic by its searchParams alone: no revalidate, no dynamic, no generateStaticParams, no other request-time API", () => {
    expect(route).toMatch(/\bsearchParams\b/);
    expect(route).not.toMatch(/^export const revalidate\b/m);
    expect(route).not.toMatch(/^export const dynamic\b/m);
    expect(route).not.toMatch(/generateStaticParams/);
    for (const code of modules) {
      expect(code).not.toMatch(/\bconnection\s*\(/);
      expect(code).not.toMatch(/\bheaders\s*\(/);
      expect(code).not.toMatch(/\bcookies\s*\(/);
      expect(code).not.toMatch(/from "next\/headers"/);
    }
  });

  it("never answers a 404 or a redirect: no DataNotFound, which sets its 404 only on an ISR route, no notFound() and no redirect", () => {
    for (const code of modules) {
      expect(code).not.toMatch(/\bDataNotFound\b/);
      expect(code).not.toMatch(/\bNOT_FOUND_METADATA\b/);
      expect(code).not.toMatch(/\bnotFound\s*\(/);
      expect(code).not.toMatch(/\b(?:permanentRedirect|redirect)\s*\(/);
    }
  });

  it("has no loading.tsx and no Suspense boundary, so a CMS error is a 500 before anything is sent, and has an error boundary that reads nothing from the error", () => {
    expect(existsSync(join(APP, "search/loading.tsx"))).toBe(false);
    for (const code of modules) {
      expect(code).not.toMatch(/\bSuspense\b/);
    }
    const boundary = withoutComments(source("app/search/error.tsx"));
    expect(boundary).toMatch(/^"use client";$/m);
    // No `error` prop at all: the message and digest are never rendered, so no CMS detail can be.
    expect(boundary).not.toMatch(/\berror\b/);
  });

  it("has no route below it, so /search/{anything}/ stays the proxy's 404", () => {
    const below = readdirSync(join(APP, "search"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(below).toEqual([]);
  });
});
