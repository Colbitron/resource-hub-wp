/**
 * The canonical form of a `/resources/**` path, decided from the path alone
 * (root `CLAUDE.md`, "Public URLs"; ADRs 0025, 0035 and 0049). `proxy.ts`
 * sends a request for a non-canonical path a single-hop 308 to the form this
 * module computes, with `Cache-Control: no-store`, before any route runs.
 *
 * Two rules, both functions of the URL alone, so the answer can never be
 * wrong and never changes with the CMS's data:
 *
 * 1. Upper-case ASCII letters outside percent escapes are lower-cased, in
 *    every segment, `resources` included: `/resources/Webinar/` is
 *    `/resources/webinar/`. Every slug the CMS stores is lower case
 *    (`canonicalSlug` in `lib/routes.ts`), so a lower-cased path is the only
 *    one that can be a page's own URL. Escapes are left exactly as sent, hex
 *    case included, because Next.js normalises them before a page sees them
 *    (`%e6%97%a5` and `%E6%97%A5` both arrive as `%E6%97%A5`, ADR 0049), so
 *    a redirect between the two hex cases would be a redirect to itself. An
 *    escape of an unreserved ASCII character (`%57ebinar`) is decoded first,
 *    as Next.js would decode it, and then lower-cased with the rest; a stored
 *    slug never holds such an escape (`slugProblem`), so decoding cannot turn
 *    a canonical path into another slug's.
 * 2. A trailing `/page/1/` is dropped: page 1 of a listing is the listing's
 *    own path (`listingPath` in `lib/routes.ts`), so `/resources/page/1/` is
 *    `/resources/` and `/resources/webinar/topic/a11y/page/1/` is
 *    `/resources/webinar/topic/a11y/`. `page` is a reserved segment, so the
 *    two segments can only ever mean a page number, whichever listing they
 *    end. Other page segments (`0`, `01`, `1.5`, `x`) are not redirected:
 *    there is no canonical form to send them to, so the route answers 404.
 *
 * Everything else about a path, a type or topic that does not exist, a page
 * past the end, a wrong type segment on a resource, needs data and is decided
 * by the route (`notFound()`, or `lib/redirects.ts` on the resource page). The
 * proxy never reads the data layer.
 *
 * Pure: no Next.js import, so `proxy.ts` and the unit tests share it.
 */

const LIBRARY_PREFIX = "/resources";

/** RFC 3986's unreserved characters, which Next.js decodes in a path segment before a page sees it. */
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/** A percent escape, or a run of upper-case ASCII letters outside one. */
const ESCAPE_OR_UPPER = /%[0-9A-Fa-f]{2}|[A-Z]+/g;

/**
 * `segment` with every escape of an unreserved ASCII character decoded, once,
 * and every other upper-case ASCII letter lower-cased. Other escapes keep
 * their bytes and their hex case.
 */
function canonicalSegment(segment: string): string {
  return segment.replace(ESCAPE_OR_UPPER, (match) => {
    if (!match.startsWith("%")) {
      return match.toLowerCase();
    }
    const character = String.fromCharCode(Number.parseInt(match.slice(1), 16));
    return UNRESERVED.test(character) ? character.toLowerCase() : match;
  });
}

/** True when `pathname` is `/resources` or under it, in any letter case. */
export function isResourcesPath(pathname: string): boolean {
  const head = pathname.slice(0, LIBRARY_PREFIX.length).toLowerCase();
  const next = pathname.charAt(LIBRARY_PREFIX.length);
  return head === LIBRARY_PREFIX && (next === "" || next === "/");
}

/**
 * The canonical form of `pathname` under the two rules above, or `null` when
 * `pathname` is already canonical or is not a `/resources/**` path. The
 * trailing slash is kept as given: `trailingSlash: true` adds a missing one
 * with its own redirect before the proxy runs. The query string is not part
 * of the path and is the caller's to keep.
 */
export function canonicalResourcesPath(pathname: string): string | null {
  if (!isResourcesPath(pathname)) {
    return null;
  }
  const trailingSlash = pathname.endsWith("/");
  const segments = pathname.split("/").filter((segment) => segment !== "").map(canonicalSegment);
  if (segments.length >= 3 && segments.at(-2) === "page" && segments.at(-1) === "1") {
    segments.splice(-2, 2);
  }
  const canonical = `/${segments.join("/")}${trailingSlash && segments.length > 0 ? "/" : ""}`;
  return canonical === pathname ? null : canonical;
}
