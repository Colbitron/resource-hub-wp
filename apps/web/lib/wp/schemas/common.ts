import { z } from "zod";

/**
 * Building blocks shared by the contract schemas, mirroring the `$defs` in
 * `packages/ui/schemas/common.schema.json`, which stays the source of truth
 * (ADR 0010). Every schema under `lib/wp/schemas/` is hand-written Zod and is
 * proved against the package's valid and invalid fixtures in
 * `test/schemas.test.ts`.
 *
 * These modules are pure (no `server-only` import) so the unit tests can load
 * them; the fetchers that use them are server-only.
 *
 * Where Zod cannot say exactly what the JSON Schema says, the comment on that
 * schema says how the two differ.
 */

/**
 * The length JSON Schema's `minLength` and `maxLength` count: Unicode code
 * points. Zod's `.min()` and `.max()` on a string count UTF-16 code units
 * (`string.length`), which counts a character outside the Basic Multilingual
 * Plane (an emoji, say) as two, so a limit that must match the schema is a
 * refinement over this instead.
 */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * `$defs/id`: a WordPress post or term ID, a positive integer, never a string.
 *
 * Stricter than the schema in one case: `z.int()` accepts only safe integers,
 * so an integer above `Number.MAX_SAFE_INTEGER`, which the schema's
 * `"type": "integer"` accepts, is rejected. Such a number cannot survive
 * `JSON.parse` exactly, so it could only ever name the wrong object.
 */
export const idSchema = z.int().min(1);

/**
 * `$defs/slug`: non-empty, at most 200 characters, no slash and no whitespace.
 * The length is counted in code points, as the schema counts it, and the
 * pattern is the schema's with the `u` flag Ajv compiles patterns with.
 */
export const slugSchema = z
  .string()
  .min(1, { error: "must not be empty" })
  .regex(/^[^/\s]+$/u, { error: "must not contain a slash or whitespace" })
  .refine((value) => codePointLength(value) <= 200, {
    error: "must be at most 200 characters",
  });

/**
 * `$defs/reservedTypeSlugs`: the words a `resource_type` slug may never be,
 * because `/resources/topic/[topic]/` and `/resources/[type]/page/[n]/` already
 * use them as path segments (ADR 0034).
 */
export const RESERVED_TYPE_SLUGS = ["topic", "page"] as const;

/** True when `slug` is `topic` or `page`. */
export function isReservedTypeSlug(slug: string): boolean {
  return (RESERVED_TYPE_SLUGS as readonly string[]).includes(slug);
}

export const RESERVED_TYPE_SLUG_MESSAGE =
  'must not be "topic" or "page", which are reserved route segments';

/** `$defs/typeSlug`: a slug that is not a reserved word. */
export const typeSlugSchema = slugSchema.refine((value) => !isReservedTypeSlug(value), {
  error: RESERVED_TYPE_SLUG_MESSAGE,
});

/** `$defs/topicSlug`: any slug. Topics have no reserved words. */
export const topicSlugSchema = slugSchema;

/**
 * `$defs/typeList`: exactly one type slug. A one-element tuple, so the inferred
 * type is `[string]` and `types[0]` is a `string`, not `string | undefined`.
 */
export const typeListSchema = z.tuple([typeSlugSchema]);

/**
 * `$defs/topicList`: topic slugs, possibly none, each listed once
 * (`uniqueItems`). The items are strings, so a `Set` compares them exactly as
 * JSON Schema's equality does.
 */
export const topicListSchema = z
  .array(topicSlugSchema)
  .refine((topics) => new Set(topics).size === topics.length, {
    error: "must not list a topic twice",
  });

/**
 * `$defs/path`: a front-end path from the site root. One leading slash, never
 * two (`//host` is a protocol-relative URL, not a path), and no whitespace.
 */
export const pathSchema = z
  .string()
  .regex(/^\/(?!\/)\S*$/u, {
    error: "must start with a single slash and contain no whitespace",
  });
