import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
 * What it reads, exactly: each `page.tsx`, and every `layout` and
 * `template` file in the page's directory or above it up to `app/`, since
 * those render with the page and a request-time call in one makes every
 * page under it dynamic. "Dynamic" is read from that source: `searchParams`,
 * `connection()`, `headers()`, `cookies()`, an import from `next/headers`,
 * `noStore()` or `unstable_noStore()`, a `cache: "no-store"` fetch option,
 * or an `export const dynamic`. It also refuses a `loading` file anywhere on
 * a page's path. Comments are dropped first, so prose that names an API is
 * not mistaken for a call.
 *
 * What it does not read: the components, data modules and libraries a page
 * imports. A request-time call deep in one of those is caught only by the
 * end-to-end suite, where it turns an ISR route into a 500 or a page that is
 * never stored. The search page's own modules (`components/SearchPage.tsx`,
 * `components/SearchForm.tsx`, `lib/search-request.ts`) are read by the
 * tests below. Test-only pages are `page.fixture.tsx` (routes only under
 * `RH_FIXTURES=1`) and are not pages here.
 */

const APP = fileURLToPath(new URL("../app", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The one dynamic route, and why it may be: a search is the visitor's own words, so no query can be prerendered. */
const DYNAMIC_ROUTES = ["app/search/page.tsx"];

/** The ISR routes' interval, the literal each exports: the data layer's (`listing-routes.test.ts` checks the two are equal). */
const ROUTE_REVALIDATE = 3600;

/** The extensions Next.js reads a special file (`layout`, `template`, `loading`) from. */
const EXTENSIONS = ["tsx", "ts", "jsx", "js"];

function toRelative(path: string): string {
  return relative(ROOT, path).split("\\").join("/");
}

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === "page.tsx" ? [toRelative(path)] : [];
  });
}

/** The directories from `app/` down to the page's own, outermost first. */
function directoriesOf(page: string): string[] {
  const directories: string[] = [];
  let dir = dirname(join(ROOT, page));
  for (;;) {
    directories.unshift(dir);
    if (dir === APP || !dir.startsWith(APP)) break;
    dir = dirname(dir);
  }
  return directories;
}

/** Every file named `name` (any extension) on the page's path, as relative paths. */
function onPath(page: string, name: string): string[] {
  return directoriesOf(page).flatMap((dir) => EXTENSIONS.map((extension) => join(dir, `${name}.${extension}`)).filter((file) => existsSync(file)).map(toRelative));
}

/** The files that render with the page: its layouts and templates, outermost first, and the page. */
function renderedWith(page: string): string[] {
  return [...onPath(page, "layout"), ...onPath(page, "template"), page];
}

function source(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

/** `code` without its comments, so prose that names an API is not mistaken for a call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The request-time uses in `code` the rule names, other than `searchParams`. */
const REQUEST_TIME = [
  /\bconnection\s*\(/,
  /\bheaders\s*\(/,
  /\bcookies\s*\(/,
  /from\s+["']next\/headers["']/,
  /\b(?:unstable_)?noStore\s*\(/,
  /\bcache\s*:\s*["']no-store["']/,
  /^export const dynamic\b/m,
];

function isDynamic(code: string): boolean {
  return /\bsearchParams\b/.test(code) || REQUEST_TIME.some((pattern) => pattern.test(code));
}

const ALL = pages(APP);

describe("the page routes", () => {
  it("are found: the eight listings, the resource, the page catch-all and the search page", () => {
    expect(ALL).toHaveLength(11);
    expect(ALL).toEqual(expect.arrayContaining(DYNAMIC_ROUTES));
  });

  it("have one dynamic route, the search page, so a second fails here until ADR 0043 and the caching rule name it", () => {
    const dynamic = ALL.filter((file) => renderedWith(file).some((rendered) => isDynamic(withoutComments(source(rendered)))));
    expect(dynamic).toEqual(DYNAMIC_ROUTES);
  });

  it("read the root layout, and no layout or template on any page's path makes a request-time call", () => {
    const shared = [...new Set(ALL.flatMap((page) => renderedWith(page).filter((file) => file !== page)))];
    expect(shared).toContain("app/layout.tsx");
    for (const file of shared) {
      expect(isDynamic(withoutComments(source(file))), file).toBe(false);
    }
  });

  it("have no loading file anywhere on their path, the search page included", () => {
    for (const page of ALL) {
      expect(onPath(page, "loading"), page).toEqual([]);
    }
  });

  for (const file of ALL.filter((page) => !DYNAMIC_ROUTES.includes(page))) {
    it(`${file} is ISR: revalidate = ${ROUTE_REVALIDATE} as a literal and a generateStaticParams`, () => {
      const code = withoutComments(source(file));
      const matches = [...code.matchAll(/^export const revalidate = (.+);$/gm)];
      expect(matches.map((match) => match[1])).toEqual([String(ROUTE_REVALIDATE)]);
      expect(code).toMatch(/^export (?:async )?function generateStaticParams\(/m);
    });
  }
});

describe("the search page, the one dynamic route", () => {
  const route = withoutComments(source("app/search/page.tsx"));
  // The page's own modules: what it renders and how it reads its request.
  const modules = ["app/search/page.tsx", "components/SearchPage.tsx", "components/SearchForm.tsx", "lib/search-request.ts"].map((file) => withoutComments(source(file)));

  it("is dynamic by its searchParams alone: no revalidate, no dynamic, no generateStaticParams, no other request-time use", () => {
    expect(route).toMatch(/\bsearchParams\b/);
    expect(route).not.toMatch(/^export const revalidate\b/m);
    expect(route).not.toMatch(/generateStaticParams/);
    for (const code of modules) {
      for (const pattern of REQUEST_TIME) {
        expect(code).not.toMatch(pattern);
      }
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

  it("has no Suspense boundary (and, above, no loading file), so a CMS error is a 500 before anything is sent, and has an error boundary that reads nothing from the error", () => {
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
