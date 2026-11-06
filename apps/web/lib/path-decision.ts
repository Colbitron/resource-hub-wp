/**
 * What `proxy.ts` answers from the path alone, before any route runs: a
 * single-hop 308 to the canonical form of a non-canonical path
 * (`lib/canonical-path.ts`; ADRs 0025, 0035, 0052), or the not-found page's
 * HTML for a path no route could ever answer with anything but a 404
 * (issue #46), or nothing, leaving the request to its route.
 *
 * Why the proxy answers a 404 at all: a `notFound()` thrown by a page is
 * sent by Next.js 16.4.5 as its empty `__next_error__` document, with
 * `app/not-found.tsx` only in the inlined RSC payload, rendered on
 * hydration, so without JavaScript, and to a crawler, the body is empty
 * (ADR 0050's 2026-11-05 amendment). Only the prerendered `/_not-found`
 * route, which the router renders for a URL no route matches, has the page
 * in its HTML. Since ADR 0052 the root catch-all matches every URL, so no
 * request reaches that fallback on its own; a rewrite from the proxy to
 * `/_not-found` is what reaches it, measured on 16.4.5 under `next start`
 * (`e2e/errors.spec.ts` pins it): the prerendered HTML, status 404 (the
 * server treats the route as its 404 page and sets the status itself),
 * `noindex` in the head, and the RSC payload for a client-side navigation.
 * The proxy reads no data, so it can answer only the 404s that are decided
 * from the path alone; the routes still answer with `notFound()` what needs
 * the CMS (an unknown slug, an unknown term, a page past the end, a path no
 * page has), and those keep the empty document until Next.js renders the
 * not-found boundary into the HTML upstream.
 *
 * Which paths are decided here, each by the same function the route uses,
 * so the proxy and the route cannot disagree:
 *
 * - Outside the library: a path the page catch-all answers with a 404
 *   without a request (`pagePathProblem` in `lib/routes.ts`, the catch-all's
 *   own check): a segment that is not a slug or holds a dot (`robots.txt`,
 *   `wp-login.php`, `.env`), a first segment the front end's own routes use
 *   (`api`, `resources` in another case), or a path over the plugin's cap.
 *   The front end's own routes under those segments, the revalidate route
 *   and the favicon (`OWN_ROUTE_PATHS`), are left alone, and so is
 *   everything under `/_next/` and `/media/`, which the framework and the
 *   uploads rewrite own (a junk `/_next/x/` path still falls through to the
 *   catch-all's empty 404: the proxy's matcher keeps out of `/_next/`, where
 *   every asset request would pay for it).
 * - Under the library: a shape no listing or resource route has
 *   (`parseResourcesSegments`: `/resources/topic/`, `/resources/a/b/c/`), a
 *   listing whose segments the listing refuses (`validListing`: a reserved
 *   word or a non-slug as the type, a non-slug topic, a page segment that is
 *   not a number 2 or more), or a resource whose type or slug segment is not
 *   a slug (`isTypeSlug`, `isSlug`, the resource page's own first check).
 *
 * The 404 is decided on the canonical form of the path and wins over the
 * redirect: `/Robots.TXT` is a 404 at once, not a 308 to `/robots.txt` and
 * then a 404, since a path that cannot be a page has no canonical URL to
 * send anyone to; `/Favicon.ICO` still redirects, as the favicon is a route.
 *
 * Pure: no Next.js import, so `proxy.ts` and the unit tests share it, and
 * `test/proxy-matcher.test.ts` checks the matcher reaches every path this
 * module would act on.
 */

import { canonicalPath, isResourcesPath } from "./canonical-path";
import { isSlug, isTypeSlug, OWN_ROUTE_PATHS, pagePathProblem, parseResourcesSegments, validListing } from "./routes";

/**
 * The route the proxy rewrites a path-decided 404 to: the App Router's
 * prerendered not-found route, which the router itself renders for a URL
 * no route matches and whose request the server treats as its 404 page.
 * Not a public URL; the rewrite is internal and the browser keeps the
 * requested path.
 */
export const NOT_FOUND_ROUTE = "/_not-found";

export type PathDecision = { readonly kind: "redirect"; readonly path: string } | { readonly kind: "not-found" };

const NOT_FOUND: PathDecision = { kind: "not-found" };

/** The first segments the proxy never decides a 404 under: the framework's assets and the uploads rewrite. */
const NOT_OURS = new Set(["_next", "media"]);

/** `/a/b/` as `a/b`, so the two trailing-slash forms compare equal. */
function joined(segments: readonly string[]): string {
  return segments.join("/");
}

const OWN_ROUTES = new Set(OWN_ROUTE_PATHS.map((path) => joined(path.split("/").filter((segment) => segment !== ""))));

/**
 * True when `canonical`, a path in canonical form, can only ever be a 404,
 * whatever the CMS holds: see the module comment for the rules.
 */
export function isNotFoundPath(canonical: string): boolean {
  const segments = canonical.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) {
    return false;
  }
  if (isResourcesPath(canonical)) {
    const parsed = parseResourcesSegments(segments.slice(1));
    if (parsed === null) {
      return true;
    }
    if (parsed.kind === "listing") {
      return validListing(parsed.request) === null;
    }
    return !isTypeSlug(parsed.type) || !isSlug(parsed.slug);
  }
  if (NOT_OURS.has(segments[0].toLowerCase()) || OWN_ROUTES.has(joined(segments))) {
    return false;
  }
  return pagePathProblem(segments) !== null;
}

/**
 * The proxy's answer for `pathname`: a 404 when its canonical form can only
 * be one, otherwise a redirect to that form when it differs from the
 * request, otherwise `null`, and the request goes to its route. The
 * trailing slash and the query string are handled as for `canonicalPath`.
 */
export function decidePath(pathname: string): PathDecision | null {
  const canonical = canonicalPath(pathname) ?? pathname;
  if (isNotFoundPath(canonical)) {
    return NOT_FOUND;
  }
  return canonical === pathname ? null : { kind: "redirect", path: canonical };
}
