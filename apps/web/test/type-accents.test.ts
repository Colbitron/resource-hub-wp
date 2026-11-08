import { describe, expect, it } from "vitest";

import table from "@colbitron/resource-hub-ui/type-accents.json";

import { TERMS } from "../e2e/mock-cms/seed.mts";
import { markToken, TYPE_ACCENTS, typeAccent } from "../lib/type-accents";

/**
 * The type-accent table is the shared package's `type-accents.json`, read by
 * `lib/type-accents.ts` here and by the plugin's block from its build
 * (`packages/ui/README.md`, "Type accents"). It is keyed by term ID, so it
 * is only right while the IDs are the ones the CMS has. The mock CMS's seed
 * carries the same `resource_type` IDs as the hosted CMS and the local
 * wp-env, so it stands in for them here: every row must name a seeded
 * type by the ID and slug the seed has, and every seeded type must have a
 * row. That no two types share an accent is the package's own test
 * (`packages/ui/test/type-accents.test.js`), checked here too since this
 * is where a mark would show it.
 */

const SEEDED_TYPES = TERMS.filter((term) => term.taxonomy === "resource_type");

describe("the type-accent table", () => {
  it("is the shared package's table, row for row, with no copy of its own", () => {
    expect(TYPE_ACCENTS).toEqual(table.types);
  });

  it("matches the seed's resource_type terms, row for row", () => {
    const rows = [...TYPE_ACCENTS].sort((a, b) => a.id - b.id).map(({ id, slug }) => ({ id, slug }));
    const seeded = SEEDED_TYPES.map(({ id, slug }) => ({ id, slug })).sort((a, b) => a.id - b.id);
    expect(rows).toEqual(seeded);
  });

  it("gives every type a different accent", () => {
    const accents = TYPE_ACCENTS.map((row) => row.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it("maps each seeded type by its ID and slug", () => {
    for (const term of SEEDED_TYPES) {
      expect(typeAccent(term), term.slug).not.toBe("neutral");
    }
    expect(typeAccent({ id: 7, slug: "case-study" })).toBe("cobalt");
  });

  it("is neutral for an unknown ID, and for a known ID whose slug has changed", () => {
    expect(typeAccent({ id: 999, slug: "article" })).toBe("neutral");
    expect(typeAccent({ id: 3, slug: "renamed" })).toBe("neutral");
  });

  it("names the mark token for an accent, and the ink for neutral", () => {
    expect(markToken("coral")).toBe("--rh-mark-coral");
    expect(markToken("neutral")).toBe("--rh-color-text");
  });
});
