/**
 * Which brand accent marks each resource type (`packages/ui/DESIGN.md`,
 * "Colors"). The mark is a small dot beside the type's printed name, never
 * the name's colour and never beside a link, so nothing is said by colour
 * alone; the cobalt dot in particular is kept away from cobalt links.
 *
 * The table is keyed by the `resource_type` term's ID, which is the same on
 * the hosted CMS, the local wp-env and the mock CMS's seed
 * (`e2e/mock-cms/seed.mts`; `test/type-accents.test.ts` checks every row
 * against it), with the slug the ID is expected to carry. A type the table
 * does not know, or whose slug no longer matches, gets the neutral mark:
 * adding a type is a development change that ships its row here, in the
 * same change and deploy as the term, so a new type is never coloured by
 * accident.
 */

/** The five brand accents, each a `--rh-mark-*` token in `tokens.css`. */
export type BrandAccent = "coral" | "cobalt" | "lemon" | "mint" | "grape";

/** A mark's colour: a brand accent, or the neutral ink for a type the table does not know. */
export type MarkAccent = BrandAccent | "neutral";

export interface TypeAccentRow {
  /** The `resource_type` term's ID. */
  readonly id: number;
  /** The slug that ID is expected to carry; a mismatch means the table is stale. */
  readonly slug: string;
  readonly accent: BrandAccent;
}

export const TYPE_ACCENTS: readonly TypeAccentRow[] = [
  { id: 3, slug: "article", accent: "mint" },
  { id: 4, slug: "ebook", accent: "grape" },
  { id: 5, slug: "webinar", accent: "coral" },
  { id: 6, slug: "podcast", accent: "lemon" },
  { id: 7, slug: "case-study", accent: "cobalt" },
];

const BY_ID: ReadonlyMap<number, TypeAccentRow> = new Map(TYPE_ACCENTS.map((row) => [row.id, row]));

/**
 * The accent for a type term, by its ID, when the term's slug is the one
 * the table expects; `"neutral"` otherwise.
 */
export function typeAccent(term: { readonly id: number; readonly slug: string }): MarkAccent {
  const row = BY_ID.get(term.id);
  return row !== undefined && row.slug === term.slug ? row.accent : "neutral";
}

/** The custom property a mark of this accent is painted with. */
export function markToken(accent: MarkAccent): string {
  return accent === "neutral" ? "--rh-color-text" : `--rh-mark-${accent}`;
}
