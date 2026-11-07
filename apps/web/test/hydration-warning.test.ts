import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { keyOf, parse, root, sourceFiles, tagOf, targetOf } from "./source-scan";

/**
 * `suppressHydrationWarning` belongs on the root layout's `<html>` and
 * nowhere else (`packages/ui/DESIGN.md`, "Theme and colour scheme"): the
 * head script changes that one element's attributes before React hydrates,
 * and the prop stops React keeping the server's markup there. Anywhere else
 * it would hide a real mismatch.
 *
 * This is checked in the source, because nothing at run time can: a
 * production build never reports an attribute mismatch, with or without
 * the prop, so the end-to-end specs, which run that build, would pass
 * either way. Every `.ts` and `.tsx` file under `app/`, `components/` and
 * `lib/` is parsed with the TypeScript compiler (`source-scan.ts`), and
 * every way the prop can be written is listed with where it lands: a JSX
 * attribute, and a property name in an object literal, which covers a JSX
 * spread (`{...{ suppressHydrationWarning: true }}`), a `createElement`
 * props argument, and an object built first and spread or passed later.
 */

const PROP = "suppressHydrationWarning";

interface Use {
  file: string;
  element: string;
}

function uses(file: string): Use[] {
  const source = parse(file);
  const found: Use[] = [];
  const add = (element: string) => found.push({ file: relative(root, file), element });
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === PROP) {
      add(tagOf(node.parent.parent, source));
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (!ts.isSpreadAssignment(property) && keyOf(property.name) === PROP) {
          add(targetOf(node, source));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("suppressHydrationWarning", () => {
  const files = sourceFiles();

  it("finds the source to check", () => {
    const names = files.map((file) => relative(root, file));
    expect(names).toContain(join("app", "layout.tsx"));
    expect(names).toContain(join("components", "ThemeToggle.tsx"));
    expect(names).toContain(join("lib", "theme-store.ts"));
  });

  it("is on the root layout's <html> and on no other element", () => {
    expect(files.flatMap(uses)).toEqual([{ file: join("app", "layout.tsx"), element: "html" }]);
  });

  it("is set to true, not to an expression that could be false", () => {
    const source = parse(join(root, "app", "layout.tsx"));
    const values: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === PROP) {
        values.push(node.initializer === undefined ? "true" : node.initializer.getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(values).toEqual(["true"]);
  });
});
