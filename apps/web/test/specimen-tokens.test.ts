import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { SPECIMEN_TOKENS } from "../app/fixtures/specimen/tokens";

/**
 * The specimen page (`app/fixtures/specimen/`) shows every shared token, so a
 * token added to `tokens.css` without a place on the page fails here, and so
 * does one the page still lists after `tokens.css` dropped it.
 * `e2e/specimen.spec.ts` checks the rendered page has an entry for each.
 */

const require = createRequire(import.meta.url);

/** Every custom property `tokens.css` declares, in either scheme, once each. */
function declaredTokens(): string[] {
  const css = readFileSync(require.resolve("@colbitron/resource-hub-ui/tokens.css"), "utf8");
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = [...withoutComments.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]);
  return [...new Set(names)];
}

describe("the specimen's token list", () => {
  it("reads tokens from tokens.css, all of them --rh-*", () => {
    const declared = declaredTokens();
    expect(declared.length).toBeGreaterThan(30);
    expect(declared.filter((name) => !name.startsWith("--rh-"))).toEqual([]);
  });

  it("has every token tokens.css declares", () => {
    const shown = new Set(SPECIMEN_TOKENS);
    expect(declaredTokens().filter((name) => !shown.has(name))).toEqual([]);
  });

  it("has no token tokens.css no longer declares, and none twice", () => {
    const declared = new Set(declaredTokens());
    expect(SPECIMEN_TOKENS.filter((name) => !declared.has(name))).toEqual([]);
    expect(new Set(SPECIMEN_TOKENS).size).toBe(SPECIMEN_TOKENS.length);
  });
});
