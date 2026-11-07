import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The page route (ADR 0052) keeps the segment config its redirects rest on,
 * the same as the resource route (see `docs/architecture/caching.md`): an ISR
 * route with the data layer's interval as a literal and a
 * `generateStaticParams` that prerenders `/` alone, and only when the CMS
 * answers for it at build (ADR 0053; `lib/prerender.ts`), so every other
 * path is rendered on its first request and stored, its 308s and 404s
 * included, until a page event or the interval clears it. There is no
 * `app/page.tsx` beside it: a route with no dynamic segment would be
 * prerendered at build whether or not the CMS answers, and would claim `/`
 * from the catch-all. Measured on Next.js 16.4.5: a request-time API or a
 * `no-store` fetch in an ISR route with no prerendered params is a runtime
 * 500. A not-found decision renders `DataNotFound`, as on the resource route,
 * so the 404's HTML is the not-found page (issue #46).
 */

const APP_DIR = new URL("../app/", import.meta.url);
const ROUTE_DIR = new URL("../app/[[...path]]/", import.meta.url);

function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, ROUTE_DIR)), "utf8");
}

/** `code` without its comments, so prose that names an API is not mistaken for a call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the page route", () => {
  const code = withoutComments(source("page.tsx"));

  it("exports revalidate = 3600 as a literal, the data layer's interval", () => {
    expect(code).toMatch(/^export const revalidate = 3600;$/m);
  });

  it("exports a generateStaticParams that is the prerender module's root probe, which is [] when the CMS does not answer", () => {
    expect(code).toMatch(/^import \{ rootPageParams \} from "@\/lib\/prerender";$/m);
    const match = /export function generateStaticParams\(\)[^\n]*\{\s*return rootPageParams\(\);\s*\}/.exec(code);
    expect(match).not.toBeNull();
  });

  it("exports no dynamic and calls no request-time API, which would be a 500 in an ISR route with no prerendered params", () => {
    expect(code).not.toMatch(/^export const dynamic\b/m);
    expect(code).not.toMatch(/\bconnection\(\)/);
    expect(code).not.toMatch(/\b(?:headers|cookies|draftMode)\(\)/);
    expect(code).not.toMatch(/no-store/);
  });

  it("has no loading.tsx and no Suspense boundary of its own, and no static app/page.tsx beside it", () => {
    expect(existsSync(fileURLToPath(new URL("loading.tsx", ROUTE_DIR)))).toBe(false);
    expect(existsSync(fileURLToPath(new URL("page.tsx", APP_DIR)))).toBe(false);
    expect(code).not.toMatch(/\bSuspense\b/);
  });

  it("has an error boundary that reads nothing from the error", () => {
    const boundary = withoutComments(source("error.tsx"));
    expect(boundary).toMatch(/^"use client";$/m);
    // No `error` prop at all: the message and digest are never rendered, so no CMS detail can be.
    expect(boundary).not.toMatch(/\berror\b/);
  });

  it("awaits the request decision first in both the page and generateMetadata", () => {
    const functions = [...code.matchAll(/export (?:async function generateMetadata|default async function \w+)[\s\S]*?\n}/g)];
    expect(functions).toHaveLength(2);
    for (const [body] of functions) {
      expect(body).toMatch(/await pageForRequest\(path \?\? \[\]\)/);
    }
  });

  it("answers a not-found decision with DataNotFound and the not-found metadata, never a notFound() of its own", () => {
    expect(code).toMatch(/<DataNotFound \/>/);
    expect(code).toMatch(/NOT_FOUND_METADATA/);
    expect(code).not.toMatch(/\bnotFound\(\)/);
  });
});
