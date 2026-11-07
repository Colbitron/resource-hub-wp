import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { THEME_INIT_SCRIPT, THEME_NOSCRIPT_STYLE } from "../lib/theme";
import { keyOf, parse, root, sourceFiles, tagOf, targetOf, unwrap } from "./source-scan";

/**
 * `dangerouslySetInnerHTML` has one exception to the rule against it
 * (`apps/web/CLAUDE.md`): the root layout's head script and the `<noscript>`
 * style rule beside it, each a constant from `lib/theme.ts` built from no
 * input. This holds the exception to exactly that, in the source, as
 * `hydration-warning.test.ts` does for its prop (`source-scan.ts`): every
 * use is listed, as a JSX attribute or as a property in an object literal,
 * with the element it lands on and what its `__html` is.
 *
 * There are two uses, both in `app/layout.tsx`, the script's `__html` the
 * bare identifier `THEME_INIT_SCRIPT` and the noscript's
 * `THEME_NOSCRIPT_STYLE`; each name is the one imported from `@/lib/theme`,
 * under its own name, and nothing in the layout declares another binding by
 * it. Then the constants: neither may close the element it is written into
 * early, so the script holds no `</script` or `</style`, and the noscript's
 * string is one `<style>` element whose rule body holds no `<` at all, so
 * its own closing `</style>` is the only closing tag in it.
 */

const PROP = "dangerouslySetInnerHTML";
const LAYOUT = join("app", "layout.tsx");
const NAMES = ["THEME_INIT_SCRIPT", "THEME_NOSCRIPT_STYLE"];

interface Use {
  file: string;
  element: string;
  /** The `__html` identifier's name when the value is exactly `{ __html: Name }`, else the value's source text. */
  html: string;
}

/** The `__html` of a prop's value: the identifier's name for `{ __html: Name }` and nothing else, or the source as written. */
function htmlOf(value: ts.Expression | undefined, source: ts.SourceFile): string {
  if (value === undefined) return "(no value)";
  const literal = unwrap(value);
  if (ts.isObjectLiteralExpression(literal) && literal.properties.length === 1) {
    const [property] = literal.properties;
    if (ts.isPropertyAssignment(property) && keyOf(property.name) === "__html" && ts.isIdentifier(property.initializer)) {
      return property.initializer.text;
    }
  }
  return value.getText(source);
}

function uses(file: string): Use[] {
  const source = parse(file);
  const found: Use[] = [];
  const add = (element: string, html: string) => found.push({ file: relative(root, file), element, html });
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === PROP) {
      const value = node.initializer !== undefined && ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
      add(tagOf(node.parent.parent, source), node.initializer === undefined ? "(no value)" : htmlOf(value, source));
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property) || keyOf(property.name) !== PROP) continue;
        add(targetOf(node, source), ts.isPropertyAssignment(property) ? htmlOf(property.initializer, source) : property.getText(source));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("dangerouslySetInnerHTML", () => {
  const files = sourceFiles();

  it("finds the source to check", () => {
    const names = files.map((file) => relative(root, file));
    expect(names).toContain(LAYOUT);
    expect(names).toContain(join("lib", "theme.ts"));
    expect(names).toContain(join("lib", "content", "render.tsx"));
  });

  it("is used twice, in the root layout: the theme's head script and the noscript style, each a bare constant", () => {
    const found = files.flatMap(uses).sort((a, b) => a.element.localeCompare(b.element));
    expect(found).toEqual([
      { file: LAYOUT, element: "noscript", html: "THEME_NOSCRIPT_STYLE" },
      { file: LAYOUT, element: "script", html: "THEME_INIT_SCRIPT" },
    ]);
  });

  it("takes both constants from @/lib/theme, under their own names, and binds neither name to anything else", () => {
    const source = parse(join(root, LAYOUT));
    const imports: string[] = [];
    const others: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportSpecifier(node) && NAMES.includes(node.name.text)) {
        const declaration = node.parent.parent.parent;
        const from = ts.isStringLiteral(declaration.moduleSpecifier) ? declaration.moduleSpecifier.text : "?";
        const typeOnly = node.isTypeOnly || declaration.importClause?.isTypeOnly === true;
        imports.push(`${node.propertyName?.getText(source) ?? node.name.text} as ${node.name.text} from ${from}${typeOnly ? " (type)" : ""}`);
        return;
      }
      if (ts.isIdentifier(node) && NAMES.includes(node.text)) {
        // Every other mention is an `__html` value; anything else (a parameter, a local, an import of the same name from elsewhere) would be a second binding.
        const parent = node.parent;
        const isHtml = ts.isPropertyAssignment(parent) && parent.initializer === node && keyOf(parent.name) === "__html";
        if (!isHtml) others.push(`${node.text} in ${ts.SyntaxKind[parent.kind]}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(imports.sort()).toEqual(NAMES.map((name) => `${name} as ${name} from @/lib/theme`));
    expect(others).toEqual([]);
  });

  it("puts no closing tag in the head script", () => {
    expect(THEME_INIT_SCRIPT).not.toMatch(/<\/script/i);
    expect(THEME_INIT_SCRIPT).not.toMatch(/<\/style/i);
  });

  it("makes the noscript string one style element whose rule holds no closing tag", () => {
    const match = /^<style>([^]*)<\/style>$/.exec(THEME_NOSCRIPT_STYLE);
    expect(match, THEME_NOSCRIPT_STYLE).not.toBeNull();
    const rule = (match as RegExpExecArray)[1];
    expect(rule).not.toContain("<");
    expect(THEME_NOSCRIPT_STYLE).not.toMatch(/<\/script/i);
    expect(THEME_NOSCRIPT_STYLE.match(/<\/style/gi)).toHaveLength(1);
  });
});
