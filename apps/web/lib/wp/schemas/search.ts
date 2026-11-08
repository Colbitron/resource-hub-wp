import { z } from "zod";

import { idSchema } from "./common";

/**
 * The `200` body of `GET {WP_API_URL}/resource-hub/v1/search?q=…&page=n`,
 * mirroring `packages/ui/schemas/search-response.schema.json` (issue #115):
 * one page of the published resources and pages matching `q`, as IDs and
 * kinds in the engine's order, with the total and the number of pages. IDs
 * only: the front end reads the objects per kind (`searchSite` in
 * `lib/wp/search.ts`). A `q` or `page` the route refuses is a 400 in the
 * WordPress error shape (`wp-error.ts`).
 *
 * Two variants with the same rules for every known key, as for the other
 * contract responses (ADR 0010: strict where we produce, lenient on unknown
 * keys where we consume): the strict mirror for the conformance tests, and
 * the reader the data layer parses with, which drops a key it does not know.
 * A new `type` is not additive: the reader rejects it, so the front end must
 * learn a kind before the CMS sends it.
 */

/** Matches per page: the schema's `maxItems` and the route's fixed page size. */
export const SEARCH_PER_PAGE = 12;

/** The largest `page` the route takes, and the schema's largest `pages`. */
export const MAX_SEARCH_PAGE = 10;

/** Which collection a match is read from. */
export const searchItemTypeSchema = z.enum(["resource", "page"]);

const searchItemShape = {
  id: idSchema,
  type: searchItemTypeSchema,
};

const countsShape = {
  total: z.int().min(0),
  pages: z.int().min(0).max(MAX_SEARCH_PAGE),
};

/** The exact mirror of the schema: rejects unknown keys. For the conformance tests. */
export const searchResponseSchemaStrict = z.strictObject({
  items: z.array(z.strictObject(searchItemShape)).max(SEARCH_PER_PAGE),
  ...countsShape,
});

/** The reader the data layer parses with: drops unknown keys. */
export const searchResponseSchema = z.object({
  items: z.array(z.object(searchItemShape)).max(SEARCH_PER_PAGE),
  ...countsShape,
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type SearchItem = SearchResponse["items"][number];
export type SearchItemType = z.infer<typeof searchItemTypeSchema>;
