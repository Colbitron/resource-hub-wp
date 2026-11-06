/**
 * The canonical form of a public path, decided from the path alone (root
 * `CLAUDE.md`, "Public URLs"; ADRs 0025, 0035, 0049 and 0052). `proxy.ts`
 * sends a request for a non-canonical path a single-hop 308 to the form this
 * module computes, with `Cache-Control: no-store`, before any route runs.
 *
 * Two rules, both functions of the URL alone, so the answer can never be
 * wrong and never changes with the CMS's data:
 *
 * 1. Upper-case ASCII letters outside percent escapes are lower-cased, in
 *    every segment of every path the front end's pages and listings answer:
 *    `/resources/Webinar/` is `/resources/webinar/`, `/About/Team/` is
 *    `/about/team/`, and `/Resources/` is `/resources/`. Every slug the CMS
 *    stores is lower case (`canonicalSlug` in `lib/routes.ts`), so a
 *    lower-cased path is the only one that can be a page's own URL. Escapes
 *    are left exactly as sent, hex case included, because Next.js normalises
 *    them before a page sees them (`%e6%97%a5` and `%E6%97%A5` both arrive as
 *    `%E6%97%A5`, ADR 0049), so a redirect between the two hex cases would be
 *    a redirect to itself. An escape of a character Next.js decodes in params
 *    (`DECODED_IN_PARAMS` in `lib/routes.ts`: `encodeURIComponent`'s
 *    unescaped set, so `%57ebinar` and `a%27b` alike) is decoded first, as
 *    Next.js would decode it, and then lower-cased with the rest. The set is
 *    imported rather than copied, so the proxy and `slugProblem` can never
 *    disagree: a stored slug never holds such an escape, so decoding cannot
 *    turn a canonical path into another slug's. None of those characters is
 *    `/`, `%`, `?` or `#`, and none is one a URL serialiser escapes in a
 *    path, so a decoded path keeps its segments and is sent and received
 *    exactly as computed: the proxy can never redirect a path to itself. A
 *    segment holding a `%` that does not begin a well-formed escape (`%4%41`,
 *    `%zz`, a trailing `%`) is left exactly as sent: decoding the escape
 *    after a stray `%` would make a new one (`%4%41` to `%4a`, then `j`),
 *    a chain of hops rather than one. No route can render such a segment, so
 *    it gets the route's 404 or Next.js's 400 with no redirect first.
 *    A path whose first segment is one of the front end's own other than the
 *    library (`api`, `media`, `_next`, in any case) is left alone whatever
 *    its case: the revalidate route, the uploads rewrite (where an upload's
 *    file name may legitimately carry upper-case letters) and the
 *    framework's assets are not pages, and the catch-all answers such a path
 *    with a 404 without a request.
 * 2. A trailing `/page/1/` is dropped from a `/resources/**` path: page 1 of a
 *    listing is the listing's own path (`listingPath` in `lib/routes.ts`), so
 *    `/resources/page/1/` is `/resources/` and
 *    `/resources/webinar/topic/a11y/page/1/` is
 *    `/resources/webinar/topic/a11y/`. `page` is a reserved segment, so the
 *    two segments can only ever mean a page number, whichever listing they
 *    end. Other page segments (`0`, `01`, `1.5`, `x`) are not redirected:
 *    there is no canonical form to send them to, so the route answers 404.
 *    The pair is dropped once and only when what is left does not end in
 *    `page/1` again: `/resources/page/1/page/1/` is no listing, and dropping
 *    one pair would send it to `/resources/page/1/`, a second hop. It is left
 *    to the route's 404, so the computed form is always a fixed point.
 *
 * Why the case rule covers every path and not the library alone (ADR 0035's
 * and ADR 0052's 2026-11-06 amendments): the resource page and the pages
 * catch-all are ISR routes that store what they answer, and Next.js keys the
 * stored entry by the decoded path, which on a case-insensitive file system
 * (macOS, where the suite runs) makes `/About/` and `/about/` one entry.
 * Measured on 16.4.5 under `next start`: with no proxy in front, a request
 * for `/Company/` before any for `/company/` stored the page's 308 to
 * `/company/` under that key, and `/company/` then redirected to itself.
 * What Vercel's cache keys on is unmeasured. So no mixed-case request may
 * reach an ISR route at all: the proxy canonicalises it first, and the
 * pages' own mixed-case branches are a second line that only a request that
 * bypassed the proxy could reach.
 *
 * Everything else about a path, a type or topic that does not exist, a page
 * past the end, a wrong type segment on a resource, a wrong parent on a page,
 * needs data and is decided by the route (`notFound()`, `lib/redirects.ts`
 * or `lib/page-request.ts`). The proxy never reads the data layer.
 *
 * Pure: no Next.js import (and `lib/routes.ts` has none either), so
 * `proxy.ts` and the unit tests share it.
 */

import { DECODED_IN_PARAMS, isReservedRootSegment } from "./routes";

const LIBRARY_PREFIX = "/resources";

/** A percent escape, or a run of upper-case ASCII letters outside one. */
const ESCAPE_OR_UPPER = /%[0-9A-Fa-f]{2}|[A-Z]+/g;

/** A `%` that does not begin a well-formed escape. */
const MALFORMED_ESCAPE = /%(?![0-9A-Fa-f]{2})/;

/**
 * `segment` with every escape of a character in `DECODED_IN_PARAMS` decoded,
 * once, and every other upper-case ASCII letter lower-cased. Other escapes
 * keep their bytes and their hex case. A segment with a malformed escape is
 * returned as sent, so a decoded escape can never pair with a stray `%`.
 */
function canonicalSegment(segment: string): string {
  if (MALFORMED_ESCAPE.test(segment)) {
    return segment;
  }
  const canonical = segment.replace(ESCAPE_OR_UPPER, (match) => {
    if (!match.startsWith("%")) {
      return match.toLowerCase();
    }
    const character = String.fromCharCode(Number.parseInt(match.slice(1), 16));
    return DECODED_IN_PARAMS.test(character) ? character.toLowerCase() : match;
  });
  // `%2e` or `%2e%2e` alone is a dot segment to a URL parser, which removes it
  // before the proxy sees the path; decoding one here would only make a path
  // that a parser rewrites, so it is left as sent.
  return canonical === "." || canonical === ".." ? segment : canonical;
}

/** True when canonical `segments` are a listing's path with a trailing `page/1`. */
function endsInPageOne(segments: readonly string[]): boolean {
  return segments.length >= 3 && segments.at(-2) === "page" && segments.at(-1) === "1";
}

/**
 * True when `pathname` is `/resources` or under it, with `resources` in lower
 * case, which is the one form the library's routes match.
 */
export function isResourcesPath(pathname: string): boolean {
  const next = pathname.charAt(LIBRARY_PREFIX.length);
  return pathname.startsWith(LIBRARY_PREFIX) && (next === "" || next === "/");
}

/**
 * The segments of `pathname` in canonical form under rule 1, and under rule 2
 * when they are a `/resources/**` path.
 */
function canonicalSegments(pathname: string): string[] {
  const segments = pathname.split("/").filter((segment) => segment !== "").map(canonicalSegment);
  if (segments[0] === "resources" && endsInPageOne(segments) && !endsInPageOne(segments.slice(0, -2))) {
    segments.splice(-2, 2);
  }
  return segments;
}

/** `segments` joined back into a path, with the trailing slash kept as `pathname` had it. */
function joinPath(segments: readonly string[], pathname: string): string {
  const trailingSlash = pathname.endsWith("/");
  return `/${segments.join("/")}${trailingSlash && segments.length > 0 ? "/" : ""}`;
}

/**
 * The canonical form of `pathname` under the two rules above, or `null` when
 * `pathname` is already canonical or is not a `/resources/**` path: the
 * library's rule on its own. The trailing slash is kept as given:
 * `trailingSlash: true` adds a missing one with its own redirect before the
 * proxy runs. The query string is not part of the path and is the caller's
 * to keep.
 */
export function canonicalResourcesPath(pathname: string): string | null {
  if (!isResourcesPath(pathname)) {
    return null;
  }
  const canonical = joinPath(canonicalSegments(pathname), pathname);
  return canonical === pathname ? null : canonical;
}

/**
 * The canonical form of any public path, or `null` when `pathname` is
 * already canonical or is one the proxy leaves alone: the root, and a path
 * under `api`, `media` or `_next` in any case. A `/resources/**` path gets
 * both rules, every other path rule 1, and a capitalised `/Resources/…`
 * becomes `/resources/…` in the same hop. The trailing slash and the query
 * string are handled as for `canonicalResourcesPath`.
 */
export function canonicalPath(pathname: string): string | null {
  const segments = canonicalSegments(pathname);
  if (segments.length === 0 || (isReservedRootSegment(segments[0]) && segments[0] !== "resources")) {
    return null;
  }
  const canonical = joinPath(segments, pathname);
  return canonical === pathname ? null : canonical;
}
