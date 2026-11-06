import { z } from "zod";

import { idSchema, slugSchema, typeSlugSchema } from "./common";

/**
 * The `200` body of `GET {WP_API_URL}/resource-hub/v1/resolve?slug=…`,
 * mirroring `packages/ui/schemas/resolve-response.schema.json`: the current
 * identity of a public resource found by its current or an old slug. A miss is
 * a `404` in the WordPress error shape (`wp-error.ts`).
 *
 * The schema has `additionalProperties: false`. As for the revalidation
 * request (ADR 0010), there are two variants with the same rules for every
 * known key: the strict mirror for the conformance tests, and the reader the
 * data layer parses with, which drops a key it does not know, so a CMS a
 * deploy ahead that adds a field breaks nothing.
 */
const resolveResponseShape = {
  id: idSchema,
  type: typeSlugSchema,
  slug: slugSchema,
};

/** The exact mirror of the schema: rejects unknown keys. For the conformance tests. */
export const resolveResponseSchemaStrict = z.strictObject(resolveResponseShape);

/** The reader the data layer parses with: drops unknown keys. */
export const resolveResponseSchema = z.object(resolveResponseShape);

export type ResolveResponse = z.infer<typeof resolveResponseSchema>;
