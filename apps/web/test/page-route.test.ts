import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The page route (ADR 0052) keeps the segment config its redirects rest on,
 * the same as the resource route (ADR 0035's 2026-11-05 amendment): it
 * renders on every request, so a computed 308 is sent with `no-store` and
 * never stored, and the build never renders `/` from the CMS. There is no
 * `app/page.tsx` beside it: a route with no dynamic segment would be
 * prerendered at build, and would claim `/` from the catch-all.
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

  it('exports dynamic = "force-dynamic"', () => {
    expect(code).toMatch(/^export const dynamic = "force-dynamic";$/m);
  });

  it("exports no revalidate and no generateStaticParams", () => {
    expect(code).not.toMatch(/^export const revalidate\b/m);
    expect(code).not.toMatch(/generateStaticParams/);
  });

  it("has no loading.tsx and no Suspense boundary of its own, and no static app/page.tsx beside it", () => {
    expect(existsSync(fileURLToPath(new URL("loading.tsx", ROUTE_DIR)))).toBe(false);
    expect(existsSync(fileURLToPath(new URL("page.tsx", APP_DIR)))).toBe(false);
    expect(code).not.toMatch(/\bSuspense\b/);
  });

  it("has an error boundary that reads nothing from the error", () => {
    const boundary = withoutComments(source("error.tsx"));
    expect(boundary).toMatch(/^"use client";$/m);
    expect(boundary).not.toMatch(/\berror\b/);
  });

  it("awaits connection() and the request decision in both the page and generateMetadata", () => {
    const functions = [...code.matchAll(/export (?:async function generateMetadata|default async function \w+)[\s\S]*?\n}/g)];
    expect(functions).toHaveLength(2);
    for (const [body] of functions) {
      expect(body).toMatch(/await connection\(\)/);
      expect(body).toMatch(/await pageForRequest\(path \?\? \[\]\)/);
    }
  });
});
