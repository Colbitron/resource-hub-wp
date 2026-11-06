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
 * either way. Every `.ts` and `.tsx` file under `app/`, `components/` and
 * `lib/` is parsed with the TypeScript compiler, and every way the prop can
 * be written is listed with where it lands: a JSX attribute, and a property
 * name in an object literal, which covers a JSX spread
 * (`{...{ suppressHydrationWarning: true }}`), a `createElement` props
 * argument, and an object built first and spread or passed later.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const PROP = "suppressHydrationWarning";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function parse(file: string): ts.SourceFile {
  // A `.ts` file parsed as TSX would misread `<T>value` casts, so each is parsed as what it is.
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
}

interface Use {
  file: string;
  element: string;
}

/** A property's name as written: `name`, `"name"` and `["name"]` are the same key. */
function keyOf(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return undefined;
}

function tagOf(element: ts.Node, source: ts.SourceFile): string {
  return ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText(source) : "?";
}

/** Where an object literal holding the prop ends up: a JSX element it is spread on, a call it is passed to, or neither. */
function targetOf(literal: ts.ObjectLiteralExpression, source: ts.SourceFile): string {
  let node: ts.Node = literal;
  while (
    ts.isParenthesizedExpression(node.parent) ||
    ts.isAsExpression(node.parent) ||
    ts.isSatisfiesExpression(node.parent) ||
    ts.isTypeAssertionExpression(node.parent)
  ) {
    node = node.parent;
  }
  const parent = node.parent;
  if (ts.isJsxSpreadAttribute(parent)) return tagOf(parent.parent.parent, source);
  if (ts.isCallExpression(parent) && parent.arguments.includes(node as ts.Expression)) {
    const first = parent.arguments[0];
    return `${parent.expression.getText(source)}(${first === undefined ? "" : first.getText(source)})`;
  }
  return "object literal";
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
  const files = ["app", "components", "lib"].flatMap((dir) => sourceFiles(join(root, dir)));

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
