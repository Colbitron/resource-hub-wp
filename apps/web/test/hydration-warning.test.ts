import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

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
 * either way. Every `.tsx` file under `app/` and `components/` is parsed
 * with the TypeScript compiler and each JSX use of the prop is listed with
 * its element.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

interface Use {
  file: string;
  element: string;
}

function uses(file: string): Use[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Use[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "suppressHydrationWarning") {
      const element = node.parent.parent;
      found.push({
        file: relative(root, file),
        element: ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText(source) : "?",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("suppressHydrationWarning", () => {
  const files = [...tsxFiles(join(root, "app")), ...tsxFiles(join(root, "components"))];

  it("finds the source to check", () => {
    expect(files.map((file) => relative(root, file))).toContain(join("app", "layout.tsx"));
  });

  it("is on the root layout's <html> and on no other element", () => {
    expect(files.flatMap(uses)).toEqual([{ file: join("app", "layout.tsx"), element: "html" }]);
  });

  it("is set to true, not to an expression that could be false", () => {
    const layout = join(root, "app", "layout.tsx");
    const source = ts.createSourceFile(layout, readFileSync(layout, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const values: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "suppressHydrationWarning") {
        values.push(node.initializer === undefined ? "true" : node.initializer.getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(values).toEqual(["true"]);
  });
});
