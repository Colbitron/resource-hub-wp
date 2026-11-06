/**
 * What `proxy.ts` answers from the path alone, before any route runs: a
 * single-hop 308 to the canonical form of a non-canonical path
 * (`lib/canonical-path.ts`; ADRs 0025, 0035, 0052), or the not-found page's
 * HTML for a path no route could ever answer with anything but a 404
 * (issue #46), or nothing, leaving the request to its route.
 *
 * Why the proxy answers a 404 at all: a `notFound()` thrown by a page
 * outside any Suspense boundary is sent by Next.js 16.4.5 as its empty
 * `__next_error__` document, with `app/not-found.tsx` only in the inlined
 * RSC payload, rendered on hydration, so without JavaScript, and to a
 * crawler, the body is empty
 * (ADR 0050's 2026-11-05 amendment). The prerendered not-found page, which
 * the router renders for a URL no route matches, has the page in its HTML,
 * and since ADR 0052 the root catch-all matches every URL, so no request
 * reaches that fallback on its own; a rewrite from the proxy to `/404`
 * (`NOT_FOUND_ROUTE`) with status 404 is what reaches it, on both servers
 * the app runs on. The routes' own 404s have carried the page in their HTML
 * since 2026-11-06 too (`components/DataNotFound.tsx`), each rendered and
 * stored once per URL; the rewrite stays for the paths decided here because
 * it renders nothing and stores nothing per URL, so junk traffic shares one
 * cached copy. Under `next start` (`e2e/errors.spec.ts` pins it) `/404`
 * is the pathname Next.js's server treats as its 404 page and answers with
 * the prerendered `app/not-found.tsx`: the HTML, status 404, `noindex` in
 * the head, and one shared route-cache entry rather than one per junk URL.
 * On Vercel `/404` is the static `404.html` its Next.js builder writes from
 * that same prerender and serves for its own 404s, cached at the CDN by
 * that one destination rather than per junk URL, with no page render and
 * no per-URL entry (the proxy itself still runs on every junk request);
 * the status is the rewrite's own, since Vercel serves a rewritten
 * response with the status the proxy's response carries, and a static
 * file is a 200 without it. On both servers a client-side navigation to a
 * junk URL gets a 404 for its RSC request, which the router answers with a
 * full document load, and that load gets the not-found HTML with status
 * 404 (`proxy.ts` has the measurements). The proxy reads no data, so it can answer only the 404s that are decided
 * from the path alone; the routes answer what needs the CMS (an unknown
 * slug, an unknown term, a page past the end, a path no page has) with
 * `DataNotFound`, which has the same page in its HTML.
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
 *   catch-all's own 404, which has the not-found page in its HTML through
 *   `DataNotFound` but is rendered and stored per path: the proxy's matcher
 *   keeps out of `/_next/`, where every asset request would pay for it).
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
 * The path the proxy rewrites a path-decided 404 to, with status 404: the
 * pathname Next.js's server treats as its 404 page (`is404Page` in
 * `next/dist/server/base-server.js`, which maps the App Router's
 * `/_not-found` onto it) and answers with the prerendered
 * `app/not-found.tsx`, and the path Vercel's Next.js builder serves that
 * same prerender at as a static `404.html`, the file its own 404 routing
 * uses. The App Router's `/_not-found` was the target first: it is the
 * same page under `next start`, but on Vercel it is a prerendered function
 * route, rendered and stored once per junk URL with the proxy's 200 (the
 * measurements of 2026-11-06 are in `proxy.ts`). Not a public URL; the
 * rewrite is internal and the browser keeps the requested path.
 */
export const NOT_FOUND_ROUTE = "/404";

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
