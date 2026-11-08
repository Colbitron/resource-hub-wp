import { z } from "zod";

import { idSchema, typeSlugSchema } from "./common";

/**
 * The shared type-accent table, `packages/ui/type-accents.json`, mirroring
 * `packages/ui/schemas/type-accents.schema.json`: one row per resource type
 * with an accent, by the `resource_type` term's ID, with the slug that ID is
 * expected to carry (`packages/ui/README.md`, "Type accents").
 *
 * One strict variant, unlike the CMS's responses: the table is not read
 * across a deploy but imported at build time from the same commit
 * (`lib/type-accents.ts`), so an unknown key is a mistake in this
 * repository, never a CMS a deploy ahead. The conformance tests prove it
 * against the package's fixtures, and `lib/type-accents.ts` parses the
 * table with it, so a row the stylesheets have no rule for fails the build
 * instead of rendering.
 */

/** The five brand accents, each a `--rh-mark-*` token in `tokens.css`. */
export const brandAccentSchema = z.enum(["coral", "cobalt", "lemon", "mint", "grape"]);

/** The exact mirror of the schema: rejects unknown keys. */
export const typeAccentTableSchema = z.strictObject({
  types: z.array(
    z.strictObject({
      id: idSchema,
      slug: typeSlugSchema,
      accent: brandAccentSchema,
    }),
  ),
});

export type BrandAccent = z.infer<typeof brandAccentSchema>;
export type TypeAccentTable = z.infer<typeof typeAccentTableSchema>;
