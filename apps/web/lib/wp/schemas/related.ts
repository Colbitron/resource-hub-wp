import { z } from "zod";

import { idSchema } from "./common";

/**
 * The `200` body of `GET {WP_API_URL}/resource-hub/v1/related/{id}?count=n`,
 * mirroring `packages/ui/schemas/related-response.schema.json` (issue #50):
 * the related resources' IDs in display order, picks first and then the
 * topic fill, already merged by the plugin, at most `MAX_RELATED_ITEMS`
 * and never the resource itself. IDs only: the front end reads the objects
 * with `getResourcesByIds`. A `count` out of range is a 400 and an ID that
 * is not a published resource a 404, both in the WordPress error shape
 * (`wp-error.ts`).
 *
 * Two variants with the same rules for every known key, as for the other
 * contract responses (ADR 0010: strict where we produce, lenient on unknown
 * keys where we consume): the strict mirror for the conformance tests, and
 * the reader the data layer parses with, which drops a key it does not know,
 * so a CMS a deploy ahead that adds a field breaks nothing.
 */

/** The schema's `maxItems`, and the largest `count` the route takes. */
export const MAX_RELATED_ITEMS = 10;

/** Why an item is in the list: an editor's pick, or the newest in a shared topic. */
export const relatedSourceSchema = z.enum(["pick", "topic"]);

const relatedItemShape = {
  id: idSchema,
  source: relatedSourceSchema,
};

/** The exact mirror of the schema: rejects unknown keys. For the conformance tests. */
export const relatedResponseSchemaStrict = z.strictObject({
  items: z.array(z.strictObject(relatedItemShape)).max(MAX_RELATED_ITEMS),
});

/** The reader the data layer parses with: drops unknown keys. */
export const relatedResponseSchema = z.object({
  items: z.array(z.object(relatedItemShape)).max(MAX_RELATED_ITEMS),
});

export type RelatedResponse = z.infer<typeof relatedResponseSchema>;
export type RelatedItem = RelatedResponse["items"][number];
export type RelatedSource = z.infer<typeof relatedSourceSchema>;
