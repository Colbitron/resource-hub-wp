import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement, Suspense, type ReactElement } from "react";

import { describe, expect, it } from "vitest";

import { DataNotFound, NOT_FOUND_METADATA } from "@/components/DataNotFound";
import { NotFoundContent } from "@/components/NotFoundContent";

/**
 * `DataNotFound` (issue #46): the shape that puts the not-found page in the
 * HTML of a 404 a route decides from data, measured on Next.js 16.4.5 under
 * `next start` and on Vercel, and pinned end to end in `e2e/errors.spec.ts`.
 * These check the parts the e2e suite cannot name: the boundary and its
 * fallback, the throw inside it, and that no route throws `notFound()` where
 * no boundary catches it, which would bring back the empty document.
 */

const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));

/** `code` without its comments, so prose that names an API is not mistaken for a call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("DataNotFound", () => {
  const element = DataNotFound() as ReactElement<{ fallback: ReactElement; children: ReactElement }>;

  it("is a Suspense boundary whose fallback is the not-found page's content", () => {
    expect(element.type).toBe(Suspense);
    expect(isValidElement(element.props.fallback)).toBe(true);
    expect(element.props.fallback.type).toBe(NotFoundContent);
  });

  it("throws Next.js's notFound() inside the boundary", () => {
    const child = element.props.children;
    expect(isValidElement(child)).toBe(true);
    const component = child.type as () => never;
    expect(() => component()).toThrow(expect.objectContaining({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }));
  });

  it("gives the not-found page's title as the metadata, with no robots of its own (Next.js adds noindex)", () => {
    expect(NOT_FOUND_METADATA).toEqual({ title: "Page not found" });
  });
});

describe("the routes' 404s", () => {
  it("throw notFound() only inside DataNotFound: no route, component or decision throws it outside a boundary", () => {
    const files = ["app", "components", "lib"]
      .flatMap((dir) => sourceFiles(join(WEB_DIR, dir)))
      // The fixtures are dynamic test-only routes, whose 404 bodies no spec reads.
      .filter((file) => !file.endsWith(".fixture.tsx"));
    const throwing = files
      .filter((file) => /\bnotFound\(\)/.test(withoutComments(readFileSync(file, "utf8"))))
      .map((file) => relative(WEB_DIR, file));
    expect(throwing).toEqual(["components/DataNotFound.tsx"]);
  });
});
