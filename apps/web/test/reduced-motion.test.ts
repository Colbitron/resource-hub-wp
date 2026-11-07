import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * DESIGN.md, Motion: under `prefers-reduced-motion: reduce` every transition
 * and animation is off, with no exception for small ones. No shipped
 * stylesheet declares one today; this test holds the rule for the first that
 * does. Every rule in a shipped stylesheet that sets a `transition*` or
 * `animation*` property (to anything but `none`) must be matched, in the same
 * file, by a rule for the same selector inside
 * `@media (prefers-reduced-motion: reduce)` that sets the shorthand to `none`.
 *
 * The stylesheets read are every `.css` file under `components/` and `app/`
 * (the specimen's included) and the shared package's own files.
 */

const require = createRequire(import.meta.url);
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const UI_DIR = dirname(require.resolve("@colbitron/resource-hub-ui/tokens.css"));

function cssFiles(dir: string, recurse: boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return recurse && entry.name !== "node_modules" ? cssFiles(path, true) : [];
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

interface Rule {
  selector: string;
  reduced: boolean;
  declarations: [string, string][];
}

/** The qualified rules of a stylesheet, each marked when it sits inside a reduced-motion media block. */
function rulesOf(source: string): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const stack: boolean[] = [];
  let buffer = "";
  for (const char of css) {
    if (char === "{") {
      const prelude = buffer.trim();
      buffer = "";
      if (prelude.startsWith("@")) {
        stack.push((stack.at(-1) ?? false) || /prefers-reduced-motion\s*:\s*reduce/.test(prelude));
      } else {
        rules.push({ selector: prelude.replace(/\s+/g, " "), reduced: stack.at(-1) ?? false, declarations: [] });
        stack.push(stack.at(-1) ?? false);
      }
    } else if (char === "}") {
      const rule = rules.at(-1);
      if (rule && buffer.trim()) {
        for (const declaration of buffer.split(";")) {
          const colon = declaration.indexOf(":");
          if (colon > 0) rule.declarations.push([declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim()]);
        }
      }
      buffer = "";
      stack.pop();
    } else {
      buffer += char;
    }
  }
  return rules;
}

/** Each `selector: property` that moves and is not set to `none` under reduced motion in the same stylesheet. */
function unneutralisedMotion(source: string): string[] {
  const rules = rulesOf(source);
  const offenders: string[] = [];
  for (const rule of rules.filter((candidate) => !candidate.reduced)) {
    for (const [property, value] of rule.declarations) {
      const family = /^(transition|animation)(-|$)/.exec(property)?.[1];
      if (!family || value === "none") continue;
      const neutralised = rules.some(
        (other) => other.reduced && other.selector === rule.selector && other.declarations.some(([p, v]) => p === family && /^none\b/.test(v)),
      );
      if (!neutralised) offenders.push(`${rule.selector}: ${property}`);
    }
  }
  return offenders;
}

describe("reduced motion", () => {
  it("finds a transition left on, and accepts one turned off under reduced motion", () => {
    const moving = ".a { color: red; transition: color 200ms; }\n.b { animation-name: spin; }";
    expect(unneutralisedMotion(moving)).toEqual([".a: transition", ".b: animation-name"]);
    const still = `${moving}\n@media (prefers-reduced-motion: reduce) { .a { transition: none; } .b { animation: none; } }`;
    expect(unneutralisedMotion(still)).toEqual([]);
    expect(unneutralisedMotion(".a { transition: none; }")).toEqual([]);
    expect(unneutralisedMotion("@media (forced-colors: active) { .a { transition: color 1s; } }")).toEqual([".a: transition"]);
  });

  it("every shipped stylesheet turns its motion off under prefers-reduced-motion: reduce", () => {
    const files = [...cssFiles(join(APP_DIR, "components"), false), ...cssFiles(join(APP_DIR, "app"), true), ...cssFiles(UI_DIR, false)];
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.flatMap((file) => unneutralisedMotion(readFileSync(file, "utf8")).map((item) => `${relative(APP_DIR, file)} ${item}`));
    expect(offenders).toEqual([]);
  });
});
