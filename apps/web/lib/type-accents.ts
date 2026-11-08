/**
 * Which brand accent marks each resource type (`packages/ui/DESIGN.md`,
 * "Colors"). The mark is a small dot before the type's printed name, never
 * the name's colour, so nothing is said by colour alone. Where the name is a
 * link (the resource page's meta line), the dot is drawn by the span around
 * it and sits outside the link's text and underline, so the cobalt dot is
 * never read as part of a cobalt link.
 *
 * The table is the shared package's `type-accents.json`, which the plugin's
 * related-resources block reads too (`packages/ui/README.md`, "Type
 * accents"), so the CMS's rows and these mark a type alike. It is keyed by
 * the `resource_type` term's ID, which is the same on the hosted CMS, the
 * local wp-env and the mock CMS's seed (`e2e/mock-cms/seed.mts`;
 * `test/type-accents.test.ts` checks every row against it), with the slug
 * the ID is expected to carry. A type the table does not know, or whose slug
 * no longer matches, gets the neutral mark: adding a type is a development
 * change that ships its row in the package, in the same change and deploy as
 * the term, so a new type is never coloured by accident.
 *
 * The file is parsed with the schema's mirror (`lib/wp/schemas/type-accents.ts`)
 * when this module loads, which narrows its accents from `string` and fails
 * the build rather than render a value `card-labels.css` has no rule for.
 */
import table from "@colbitron/resource-hub-ui/type-accents.json";

import { type BrandAccent, typeAccentTableSchema } from "./wp/schemas/type-accents";

export type { BrandAccent };

/** A mark's colour: a brand accent, or the neutral ink for a type the table does not know. */
export type MarkAccent = BrandAccent | "neutral";

export interface TypeAccentRow {
  /** The `resource_type` term's ID. */
  readonly id: number;
  /** The slug that ID is expected to carry; a mismatch means the table is stale. */
  readonly slug: string;
  readonly accent: BrandAccent;
}

export const TYPE_ACCENTS: readonly TypeAccentRow[] = typeAccentTableSchema.parse(table).types;

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
