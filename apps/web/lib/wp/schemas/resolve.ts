import { z } from "zod";

import { idSchema, slugSchema, typeSlugSchema } from "./common";

/**
 * The `200` body of `GET {WP_API_URL}/resource-hub/v1/resolve?slug=…`,
 * mirroring `packages/ui/schemas/resolve-response.schema.json`: the current
 * identity of a public resource found by its current or an old slug. Strict,
 * as the schema has `additionalProperties: false`. A miss is a `404` in the
 * WordPress error shape (`wp-error.ts`).
 */
export const resolveResponseSchema = z.strictObject({
  id: idSchema,
  type: typeSlugSchema,
  slug: slugSchema,
});

export type ResolveResponse = z.infer<typeof resolveResponseSchema>;
