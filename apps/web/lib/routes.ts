/**
 * The front end's public URL vocabulary: the path of every listing and of a
 * single resource, and the checks on the segments that go into them (root
 * `CLAUDE.md`, "Public URLs"; ADRs 0024 and 0034).
 *
 * - `/resources/`, `/resources/{type}/`, `/resources/topic/{topic}/` and
 *   `/resources/{type}/topic/{topic}/` are the listings; page `n` of any of
 *   them is `…/page/{n}/`, and page 1 has no `page` segment, so every listing
 *   page has one URL.
 * - `/resources/{type}/{slug}/` is a single resource.
 * - Every path ends with a slash (`trailingSlash: true`), as on the CMS.
 * - `topic` and `page` are route segments, so they are never a type slug.
 *
 * Builders throw a `RangeError` on a segment the contract does not allow
 * rather than emit a path that routes somewhere else. Callers check untrusted
 * input with `isSlug`, `isTypeSlug` and `parsePageSegment` first: a page turns
 * a bad parameter into `notFound()`, never a throw.
 *
 * Every builder, and every tag builder in `lib/tags.ts`, puts a slug through
 * `canonicalSlug` first, so a slug has one form in paths and tags whether it
 * arrives raw (`日`), as WordPress stores it (`%e6%97%a5`) or upper-cased
 * (`%E6%97%A5`, `Example`). The canonical form is lower case throughout,
 * letters and hex alike, because that is WordPress's form: `sanitize_title`
 * lower-cases the title and then percent-encodes its non-ASCII bytes in lower
 * case, so the slugs in REST responses and revalidation events are already
 * canonical and pass through unchanged.
 *
 * Pure: no Next.js, `server-only` or Zod import, so pages, the revalidate
 * route and unit tests share it.
 */

/** Words a type slug may never be, because the routes use them as segments. */
export const RESERVED_TYPE_SLUGS = ["topic", "page"] as const;

export type ReservedTypeSlug = (typeof RESERVED_TYPE_SLUGS)[number];

/** WordPress's `post_name` column width, which the shared schema's `slug` also caps at. */
const MAX_SLUG_LENGTH = 200;

const LIBRARY = "/resources/";

/** `.` and `..`, literal or percent-encoded: URL parsers collapse them, so the path would change. */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * A percent escape, a `%` that does not start one, or a character that is not
 * a `pchar` (RFC 3986). With the `u` flag a character outside the Basic
 * Multilingual Plane is one match, so its surrogate pair is encoded whole.
 */
const ESCAPE_OR_NOT_PCHAR = /%[0-9A-Fa-f]{2}|%|[^A-Za-z0-9\-._~!$&'()*+,;=:@%]/gu;

/** The message for a reserved type slug, shared with the Zod schemas. */
export const RESERVED_TYPE_SLUG_MESSAGE =
  'must not be "topic" or "page", which are reserved route segments';

/** True for `topic` and `page`. */
export function isReservedTypeSlug(value: string): value is ReservedTypeSlug {
  return (RESERVED_TYPE_SLUGS as readonly string[]).includes(value);
}

/**
 * The canonical form of a slug already known to be well-formed, without the
 * checks: `canonicalSlug` is the public, validating version.
 */
function encodeSlug(value: string): string {
  return value
    .replace(ESCAPE_OR_NOT_PCHAR, (match) =>
      match.length === 3 && match.startsWith("%") ? match : encodeURIComponent(match),
    )
    .toLowerCase();
}

/**
 * Why `value` is not a slug, or `null` when it is one. A slug is what the
 * shared schema's `$defs/slug` accepts (non-empty, at most 200 characters
 * counted in code points, no slash, no whitespace) that is also usable as a
 * path segment and a cache tag: well-formed Unicode, not a dot segment, and at
 * most 200 characters in its canonical form. WordPress stores a slug in that
 * form in a 200-character column (`post_name`, and `slug` in `wp_terms`), so a
 * longer one cannot be a stored slug; the cap also keeps every tag under
 * Next.js's 256-character limit, past which Next.js drops a tag with only a
 * warning (200 raw `日` would be 1,800 characters encoded). This is the one
 * definition: `isSlug`, `isTypeSlug`, the path and tag builders and the Zod
 * schemas in `lib/wp/schemas/common.ts` all use it, so a slug the schemas
 * accept can always be put in a path and a cache tag.
 */
export function slugProblem(value: string): string | null {
  if (value === "") {
    return "must not be empty";
  }
  if (!/^[^/\s]+$/u.test(value)) {
    return "must not contain a slash or whitespace";
  }
  if (!value.isWellFormed()) {
    return "must be well-formed Unicode";
  }
  if ([...value].length > MAX_SLUG_LENGTH) {
    return `must be at most ${MAX_SLUG_LENGTH} characters`;
  }
  if (DOT_SEGMENT.test(value)) {
    return "must not be . or .., which URL parsers collapse";
  }
  if (encodeSlug(value).length > MAX_SLUG_LENGTH) {
    return `must be at most ${MAX_SLUG_LENGTH} characters once percent-encoded, as WordPress stores it`;
  }
  return null;
}

/** True for a slug: see `slugProblem`. */
export function isSlug(value: string): boolean {
  return slugProblem(value) === null;
}

/**
 * Why `value` is not a `resource_type` slug, or `null` when it is one. The
 * reserved words are checked in any case (`Topic` too), because the canonical
 * form is lower case and would turn `Topic` into the `topic` segment.
 */
export function typeSlugProblem(value: string): string | null {
  return (
    slugProblem(value) ??
    (isReservedTypeSlug(value.toLowerCase()) ? RESERVED_TYPE_SLUG_MESSAGE : null)
  );
}

/** True for a slug that may be a `resource_type` slug: a slug that is not reserved. */
export function isTypeSlug(value: string): boolean {
  return typeSlugProblem(value) === null;
}

/** True for a page number a builder accepts: a safe integer, 1 or more. */
export function isPageNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

/**
 * The page number in a `…/page/{n}/` segment, or `null` when the segment is
 * not one. Only the canonical form counts: decimal digits with no sign, no
 * leading zero and no fraction, 2 or more, and a safe integer. `1` is `null`
 * too, because page 1 is the listing's own path; the route decides whether
 * `…/page/1/` is a 404 or a redirect.
 */
export function parsePageSegment(segment: string): number | null {
  if (!/^[1-9][0-9]*$/.test(segment)) {
    return null;
  }
  const page = Number(segment);
  return Number.isSafeInteger(page) && page >= 2 ? page : null;
}

/**
 * The canonical form of a slug, as it goes into a path segment and a cache
 * tag: existing percent escapes kept, every character a path segment does not
 * allow (`?`, `#`, a bare `%`, a backslash, any non-ASCII character)
 * percent-encoded as UTF-8, and then the whole result lower-cased, the hex of
 * every escape and the ASCII letters `A`-`Z` alike, so `topic:ABC` and
 * `topic:abc` are one tag, as WordPress's slugs are lower case. Nothing is
 * decoded, so a slug is never double-encoded, and the function is idempotent. The result is printable ASCII, which Next.js's
 * `encodeHeaderSafe` passes through unchanged, so a tag built here is the tag
 * Next.js stores and compares.
 *
 * Validates before normalising: throws a `RangeError` when `value` is not a
 * slug (`slugProblem`), so a lone surrogate never reaches `encodeURIComponent`.
 */
export function canonicalSlug(value: string): string {
  const problem = slugProblem(value);
  if (problem !== null) {
    throw new RangeError(`Not a valid slug (${problem}): ${JSON.stringify(value)}`);
  }
  return encodeSlug(value);
}

function typeSegment(type: string): string {
  const problem = typeSlugProblem(type);
  if (problem !== null) {
    throw new RangeError(`Not a valid resource type slug (${problem}): ${JSON.stringify(type)}`);
  }
  return canonicalSlug(type);
}

function slugSegment(kind: string, value: string): string {
  const problem = slugProblem(value);
  if (problem !== null) {
    throw new RangeError(`Not a valid ${kind} slug (${problem}): ${JSON.stringify(value)}`);
  }
  return canonicalSlug(value);
}

function pageSuffix(page: number): string {
  if (!isPageNumber(page)) {
    throw new RangeError(`Not a valid page number: ${String(page)}`);
  }
  return page === 1 ? "" : `page/${page}/`;
}

/** The filters a listing takes: one type, one topic, both, or neither. */
export interface ListingFilter {
  readonly type?: string;
  readonly topic?: string;
}

/** Page `page` (default 1) of the listing for `filter`. */
export function listingPath(filter: ListingFilter = {}, page = 1): string {
  let path = LIBRARY;
  if (filter.type !== undefined) {
    path += `${typeSegment(filter.type)}/`;
  }
  if (filter.topic !== undefined) {
    path += `topic/${slugSegment("topic", filter.topic)}/`;
  }
  return path + pageSuffix(page);
}

/** `/resources/`, or `/resources/page/{n}/`. */
export function libraryPath(page = 1): string {
  return listingPath({}, page);
}

/** `/resources/{type}/`, or `…/page/{n}/`. */
export function typeListingPath(type: string, page = 1): string {
  return listingPath({ type }, page);
}

/** `/resources/topic/{topic}/`, or `…/page/{n}/`. */
export function topicListingPath(topic: string, page = 1): string {
  return listingPath({ topic }, page);
}

/** `/resources/{type}/topic/{topic}/`, or `…/page/{n}/`. */
export function typeTopicListingPath(type: string, topic: string, page = 1): string {
  return listingPath({ type, topic }, page);
}

/** `/resources/{type}/{slug}/`, a single resource's canonical path. */
export function resourcePath(type: string, slug: string): string {
  return `${LIBRARY}${typeSegment(type)}/${slugSegment("resource", slug)}/`;
}
