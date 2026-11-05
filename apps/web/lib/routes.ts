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
 * rather than emit a path that routes somewhere else. A slug is used as
 * WordPress stores it: WordPress percent-encodes non-ASCII slugs itself
 * (`%e6%97%a5`), so existing `%XX` escapes are kept as they are and only
 * characters that are not legal in a path segment (`?`, `#`, a bare `%`, raw
 * non-ASCII, a backslash) are escaped. A slug is never double-encoded.
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

/** Anything that is not a `pchar` (RFC 3986), or a `%` that does not start an escape. */
const NOT_PCHAR = /%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~!$&'()*+,;=:@%]/gu;

/** True for `topic` and `page`. */
export function isReservedTypeSlug(value: string): value is ReservedTypeSlug {
  return (RESERVED_TYPE_SLUGS as readonly string[]).includes(value);
}

/**
 * True for a slug the shared schema accepts (non-empty, at most 200
 * characters, no slash, no whitespace) that is also usable as a path
 * segment: well-formed Unicode and not a dot segment.
 */
export function isSlug(value: string): boolean {
  return (
    value !== "" &&
    value.isWellFormed() &&
    [...value].length <= MAX_SLUG_LENGTH &&
    /^[^/\s]+$/u.test(value) &&
    !DOT_SEGMENT.test(value)
  );
}

/** True for a slug that may be a `resource_type` slug: a slug that is not reserved. */
export function isTypeSlug(value: string): boolean {
  return isSlug(value) && !isReservedTypeSlug(value);
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

function encodeSegment(value: string): string {
  return value.replace(NOT_PCHAR, (character) => encodeURIComponent(character));
}

function typeSegment(type: string): string {
  if (!isTypeSlug(type)) {
    throw new RangeError(`Not a valid resource type slug: ${JSON.stringify(type)}`);
  }
  return encodeSegment(type);
}

function slugSegment(kind: string, value: string): string {
  if (!isSlug(value)) {
    throw new RangeError(`Not a valid ${kind} slug: ${JSON.stringify(value)}`);
  }
  return encodeSegment(value);
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
