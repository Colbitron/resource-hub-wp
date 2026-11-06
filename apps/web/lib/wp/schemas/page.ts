import { z } from "zod";

import { isPageSegment, pagePathSegments } from "../../routes";
import { idSchema } from "./common";

/**
 * The `200` body of `GET {WP_API_URL}/resource-hub/v1/page?path=…`, mirroring
 * `packages/ui/schemas/page-response.schema.json` (ADR 0052): the published
 * page the front end serves at a public path, with the page's canonical path
 * now, or `page: null` for none. A miss is a 200, so the Data Cache keeps it.
 *
 * Two variants with the same rules for every known key, as for the other
 * contract responses (ADR 0010: strict where we produce, lenient on unknown
 * keys where we consume): the strict mirror for the conformance tests, and the
 * reader the data layer parses with, which drops a key it does not know.
 *
 * The reader is stricter than the schema on `path` in one way: every segment
 * must be a page segment (`isPageSegment`), a slug with no dot, so the path
 * can be a route and a redirect target. The schema cannot say that; a stored
 * slug that breaks it fails the read with a `CmsError` rather than produce a
 * URL that could not be served.
 */
const servablePagePathSchema = z.string().superRefine((value, ctx) => {
  const segments = pagePathSegments(value);
  if (segments === null) {
    ctx.addIssue({ code: "custom", message: "must be / or segments between slashes, each non-empty with no whitespace" });
    return;
  }
  const bad = segments.find((segment) => !isPageSegment(segment));
  if (bad !== undefined) {
    ctx.addIssue({ code: "custom", message: "has a segment that cannot be a page's slug" });
  }
});

const pageShape = {
  id: idSchema,
  path: servablePagePathSchema,
};

/** The exact mirror of the schema: rejects unknown keys. For the conformance tests. */
export const pageResponseSchemaStrict = z.strictObject({
  page: z.strictObject(pageShape).nullable(),
});

/** The reader the data layer parses with: drops unknown keys. */
export const pageResponseSchema = z.object({
  page: z.object(pageShape).nullable(),
});

export type PageResponse = z.infer<typeof pageResponseSchema>;
export type PageLookup = NonNullable<PageResponse["page"]>;
