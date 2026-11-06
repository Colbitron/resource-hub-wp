---
status: accepted
date: 2026-11-04
---

# A permanent redirect is computed, single-hop, and sent with `Cache-Control: no-store`

Type paths ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)) mean a resource's URL changes when its type changes, and a type can change back. A webinar re-typed as a podcast and then back again is the case that breaks naive redirects: with a manual redirect table and header-less 301s, browsers keep the first redirect and loop. Every redirect here is computed from the current state rather than stored: a 308 to the canonical URL, which always answers 200, in a single hop, sent with `Cache-Control: no-store`. The old path is revalidated too, so the edge cache does not keep serving it.

These redirects are the front end's: its type-mismatch redirect and its old-slug redirect ([ADR 0029](0029-old-slugs-resolve-through-core.md)). The CMS sends readers no redirects at all; its theme pages answer anonymous visitors with a 404 ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)).

The evidence, gathered 2026-11-04 with a Playwright test across Chromium 156, Firefox 157 and WebKit 27.2: Chromium caches a header-less 308 indefinitely and fails webinar → podcast → webinar with `ERR_TOO_MANY_REDIRECTS`. With `no-store`, `no-cache` or a `max-age`, all three engines asked the server again. The engine source agrees: Chromium's `GetFreshnessLifetimes` gives 301 and 308 `TimeDelta::Max()` unless a header overrules it; Firefox gives 0 heuristic freshness without `Last-Modified`; WebKit gives a 301 365 days and a 308 zero, and drops redirects marked `no-store`, `no-cache` or `must-revalidate`. Google's guidance agrees from the other side, asking for permanent redirects only "when you're sure that the redirect won't be reverted".

## Considered options

- **A stored redirect table with plain 301s.** Rejected: the loop above.

## Consequences

- Rule for the CMS and the front end alike: never send a permanent redirect without a cache header. The CMS sends anonymous visitors no redirects ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)), so the front end's are the ones in scope; the rule covers any redirect either side adds.
- A Playwright round-trip test on the front end changes a type, changes it back, and follows both URLs.
- Old slugs resolve the same way, through the resolve route ([ADR 0029](0029-old-slugs-resolve-through-core.md)), with the front end sending the 308.

## Amendment, 2026-11-05: "computed rather than stored" needs a page that renders on every request

The record above assumed the front end could compute a redirect at render time and send it with `no-store`. On Next.js 16.4.5 that is true only when the page renders on every request. From an ISR route, `permanentRedirect()` is prerendered and stored like a page, with `Cache-Control: s-maxage=3600, stale-while-revalidate=…` and no `no-store`, and a route that tries to render dynamically only when it redirects is a 500 at runtime. The resource page therefore renders per request, with the data layer's Data Cache behind it, and Next.js sends every redirect as a 308 with `private, no-cache, no-store, max-age=0, must-revalidate` that nothing stores. The measurements and the mechanism are in [ADR 0035](0035-type-paths-with-a-computed-no-store-308.md)'s amendment of the same date. "The old path is revalidated too" above still holds for the 200 that used to live at the old path; the redirect itself is never in any cache to clear. Vercel's documentation says its CDN strips `s-maxage` and sends browsers `max-age=0`, which, if it holds for an ISR 308, would also stop the loop recorded above; that is unmeasured, and ADR 0035 sets out the trade-off and the spike that will settle it, pending the owner's review.

## Amendment, 2026-11-06: the purpose stands, the literal header does not

The owner's decision of 2026-11-06 makes the resource page and the pages catch-all ISR routes, so their computed 308s are stored like their pages and cleared by the same revalidation events that make them wrong ([ADR 0035](0035-type-paths-with-a-computed-no-store-308.md)'s and [ADR 0052](0052-the-front-end-renders-the-cms-pages.md)'s amendments of that date). The rule this record set, `no-store` on every permanent redirect, is replaced by what it was for: a browser never keeps a redirect whose target can change. Measured on Next.js 16.4.5, a stored 308 leaves `next start` with `s-maxage` alone, which a browser ignores, so a `headers()` rule in `next.config.ts` puts `public, max-age=0, must-revalidate` on every response of the two routes, the header Vercel's CDN sends browsers anyway; the evidence above already showed a `max-age` is enough for Chromium, Firefox and WebKit to ask again. The redirects `proxy.ts` sends from the path alone keep `no-store`. The Chromium round trips in `e2e/resource-page.spec.ts` and `e2e/pages.spec.ts` follow a route-cache hit 308 and then its reversal, with every hop from the server.
