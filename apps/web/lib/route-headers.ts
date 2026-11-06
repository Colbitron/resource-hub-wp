import { RESERVED_ROOT_SEGMENTS } from "./routes";

/** One entry of `next.config.ts`'s `headers()`, in the shape Next.js takes. */
export interface RouteHeaders {
  source: string;
  headers: { key: string; value: string }[];
}

/**
 * The `Cache-Control` every response of the two ISR routes that can redirect
 * carries on the wire: what Vercel's CDN sends a browser for an ISR response
 * once it has consumed `s-maxage`, written out so that `next start` sends it
 * too. `max-age=0` makes a browser's copy stale at once and `must-revalidate`
 * forbids using it without asking, so a stored 308 is followed afresh on
 * every navigation and a type changed and changed back, or a front page set
 * and unset, cannot loop (ADR 0025; measured: with a `max-age`, Chromium,
 * Firefox and WebKit all asked again, see `docs/architecture/caching.md`).
 * The same header on a 200 and a 404 costs nothing a browser was not
 * already doing: Next.js's ISR responses carry no validator, so a browser
 * refetched them anyway.
 */
export const REVALIDATE_EACH_TIME = "public, max-age=0, must-revalidate";

/**
 * The single-resource route, `/resources/[type]/[slug]/`, in Next.js's
 * path-to-regexp form: the type segment is one segment that is not `topic/`
 * or `page/`, so the topic listing (`/resources/topic/[topic]/`) and page `n`
 * of the library (`/resources/page/[n]/`), which share the two-segment
 * shape, keep Next.js's own ISR header; `/resources/topics/x/` is a resource
 * page under a type called `topics` and matches. Next.js matches sources
 * with an optional trailing slash and without regard to case, so the proxy's
 * mixed-case 308 is matched too; it sets `no-store` itself and keeps it
 * (measured on 16.4.5; see `docs/architecture/caching.md`).
 */
export const RESOURCE_ROUTE_SOURCE = "/resources/:type((?!(?:topic|page)/)[^/]+)/:slug";

/**
 * The pages catch-all, `/` and `/[[...path]]/` (ADR 0052): every path whose
 * first segment is not one of the front end's own (`RESERVED_ROOT_SEGMENTS`:
 * the library, the revalidate route, the `/media/` rewrite and Next.js's own
 * `/_next/`), which is the same list the catch-all answers with a 404
 * without a request. The negative lookahead is anchored to a whole segment,
 * so `/resourcesx/` and `/apiary/` are page paths and match. The root
 * matches through the optional parameter.
 */
export const PAGES_ROUTE_SOURCE = `/:path((?!(?:${RESERVED_ROOT_SEGMENTS.join("|")})(?:/|$)).*)?`;

/**
 * The `headers()` rules for `next.config.ts` (ADR 0025; the mechanism is in
 * `docs/architecture/caching.md`): the resource page and the pages catch-all
 * are ISR and store their computed 308s like their 200s, Next.js serves a
 * stored response with `s-maxage` and no `max-age`, and Chromium keeps a 308
 * with no `max-age` for ever, which no revalidation can undo. Next.js keeps a
 * header set by these rules on an ISR response rather than its own
 * (`sendRenderResult` sets `Cache-Control` only when none is set) and still
 * answers from its route cache; a 500 keeps Next.js's `no-store`, which it
 * sets after the rules; the proxy's 308 keeps its own `no-store`. The
 * listings are matched by neither rule and keep Next.js's ISR header: their
 * only redirects come from `proxy.ts`. Pure, so `next.config.ts` and the
 * unit test share it.
 */
export function routeHeaders(): RouteHeaders[] {
  const cacheControl = [{ key: "Cache-Control", value: REVALIDATE_EACH_TIME }];
  return [
    { source: RESOURCE_ROUTE_SOURCE, headers: cacheControl },
    { source: PAGES_ROUTE_SOURCE, headers: cacheControl },
  ];
}
