import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/**
 * The source scan the prop checks share (`hydration-warning.test.ts`,
 * `dangerous-html.test.ts`): rules that nothing at run time can catch are
 * checked in the source instead, by parsing every `.ts` and `.tsx` file
 * under `app/`, `components/` and `lib/` with the TypeScript compiler. A
 * prop can be written as a JSX attribute or as a property name in an object
 * literal, which covers a JSX spread (`{...{ prop: value }}`), a
 * `createElement` props argument, and an object built first and spread or
 * passed later; `targetOf` says where such a literal lands.
 */

/** The app's root, `apps/web/`. */
export const root = fileURLToPath(new URL("..", import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every `.ts` and `.tsx` file under `app/`, `components/` and `lib/`, as absolute paths. */
export function sourceFiles(): string[] {
  return ["app", "components", "lib"].flatMap((dir) => filesUnder(join(root, dir)));
}

export function parse(file: string): ts.SourceFile {
  // A `.ts` file parsed as TSX would misread `<T>value` casts, so each is parsed as what it is.
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
}

/** A property's name as written: `name`, `"name"` and `["name"]` are the same key. */
export function keyOf(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return undefined;
}

export function tagOf(element: ts.Node, source: ts.SourceFile): string {
  return ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText(source) : "?";
}

/** Where an object literal holding a prop ends up: a JSX element it is spread on, a call it is passed to, or neither. */
export function targetOf(literal: ts.ObjectLiteralExpression, source: ts.SourceFile): string {
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

/** An expression with any parentheses, `as`, `satisfies` and `<T>` casts around it removed. */
export function unwrap(expression: ts.Expression): ts.Expression {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}
