import { z } from "zod";

import {
  isReservedTypeSlug,
  pagePathSegments,
  RESERVED_TYPE_SLUG_MESSAGE,
  RESERVED_TYPE_SLUGS,
  slugProblem,
  typeSlugProblem,
} from "../../routes";

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
 * `$defs/id`: a WordPress post or term ID, a positive integer, never a string.
 *
 * Stricter than the schema in one case: `z.int()` accepts only safe integers,
 * so an integer above `Number.MAX_SAFE_INTEGER`, which the schema's
 * `"type": "integer"` accepts, is rejected. Such a number cannot survive
 * `JSON.parse` exactly, so it could only ever name the wrong object.
 */
export const idSchema = z.int().min(1);

/**
 * A string schema that accepts exactly what `problem` returns `null` for, with
 * one issue carrying its message otherwise.
 */
function ruleSchema(problem: (value: string) => string | null) {
  return z.string().superRefine((value, ctx) => {
    const message = problem(value);
    if (message !== null) {
      ctx.addIssue({ code: "custom", message });
    }
  });
}

/**
 * `$defs/slug`: non-empty, at most 200 characters, no slash and no whitespace.
 * The 200 is counted in code points, as the schema counts it (Zod's own
 * `.max()` counts UTF-16 code units), and the pattern is the schema's with the
 * `u` flag Ajv compiles patterns with.
 *
 * The rule is `slugProblem` in `lib/routes.ts`, the one definition the path and
 * tag builders and the route's parameter checks share, so a slug this schema
 * accepts can always be put in a path and a cache tag.
 *
 * Stricter than the schema in four cases, all strings that could only ever
 * name the wrong page or never be revalidated:
 *
 * - A lone surrogate (`"\ud800"`), which is not well-formed Unicode. JSON lets
 *   a string escape one; it cannot be percent-encoded into a URL, and PHP's
 *   `json_encode` never produces one.
 * - A dot segment, `.` or `..`, literal or percent-encoded (`%2e`), which every
 *   URL parser collapses, so the path would change. WordPress's
 *   `sanitize_title` turns every `.` into `-`, so it never stores one.
 * - A slug longer than 200 characters in its canonical, percent-encoded form
 *   (`canonicalSlug`), such as 200 raw `日`, which encode to 1,800. WordPress
 *   stores the encoded form in a 200-character column, so it cannot store
 *   one, and its cache tags would pass Next.js's 256-character limit, past
 *   which Next.js drops a tag with only a warning.
 * - A percent escape of a character Next.js decodes in `params`, which is
 *   `encodeURIComponent`'s unescaped set `A-Z a-z 0-9 - _ . ! ~ * ' ( )`
 *   (`case%2dstudy`, `%41bc`, `x%7ey`, `arti%27cle`, `a%2ab`). Next.js
 *   decodes it before the page runs, so the slug's own URL
 *   reaches the page as a different slug and cannot be served. WordPress's
 *   `sanitize_title` keeps such an escape when an editor types one, so this
 *   one can come from a real CMS; a response or event carrying it fails here.
 */
export const slugSchema = ruleSchema(slugProblem);

/**
 * `$defs/reservedTypeSlugs`: the words a `resource_type` slug may never be,
 * because `/resources/topic/[topic]/` and `/resources/[type]/page/[n]/` already
 * use them as path segments (ADR 0034). Defined in `lib/routes.ts`.
 */
export { isReservedTypeSlug, RESERVED_TYPE_SLUG_MESSAGE, RESERVED_TYPE_SLUGS };

/**
 * `$defs/typeSlug`: a slug that is not a reserved word; the rule is
 * `typeSlugProblem`. Stricter than the schema on one more case: `Topic` or
 * `PAGE` is rejected like `topic` and `page`, because the canonical form is
 * lower case and would turn it into the reserved segment.
 */
export const typeSlugSchema = ruleSchema(typeSlugProblem);

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

/**
 * `$defs/pagePath`: a WordPress page's public path, `/` or `/a/b/` with
 * non-empty segments holding no slash and no whitespace (ADR 0052). Exactly
 * the schema's rule, through `pagePathSegments`; the page reader
 * (`lib/wp/schemas/page.ts`) is stricter, since it builds a route from it.
 */
export const pagePathSchema = z.string().refine((value) => pagePathSegments(value) !== null, {
  error: "must be / or segments between slashes, each non-empty with no whitespace",
});
