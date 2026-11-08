---
paths:
  - "apps/web/app/**"
  - "apps/web/lib/**"
  - "apps/web/components/**"
  - "apps/web/proxy.ts"
  - "apps/web/next.config.ts"
  - "apps/web/test/**"
  - "apps/web/e2e/**"
  - "wp-content/plugins/resource-hub-wp/src/Rest/**"
---

# Caching, URLs and redirects

- Every CMS read is a `fetch` through `cmsGet` or `cmsGetList` in `lib/wp/fetch.ts`, with `cache: "force-cache"` and the tags `lib/tags.ts` gives it, fixed from the request and never from the response, and parsed with the Zod readers in `lib/wp/schemas/`. No Cache Components, `'use cache'` or `unstable_cache`. A read outside the wrapper cannot be revalidated.
- Every route is ISR: `revalidate = 3600` as a literal, a `generateStaticParams`, no request-time API (`connection()`, anything from `next/headers`, `searchParams`), no `force-dynamic`, no `loading.tsx`. The unit tests under `test/` pin this per route, and `test/route-segments.test.ts` walks `app/` so a new page is held to it too. Four routes prerender a bounded set through the probes in `lib/prerender.ts` (the library, each type's first page, the root, the 50 newest resources and the 10 newest of each type); every other `generateStaticParams` returns `[]`. A probe makes the page's own reads under a 10 s budget and returns `[]` with one warning on any failure, so the build never fails for a CMS reason (ADR 0043, amended 2026-11-07); never let a CMS error escape a `generateStaticParams`. A module a route imports must not import a component, because Next.js inlines every stylesheet in a route's module graph into that route's HTML: the listing's reads are `lib/listing-data.ts`, not `components/ListingPage.tsx`, for that reason.
- **The one exception is the search page, `app/search/page.tsx` (`/search/?q=…`; ADR 0043, amended).** It reads `searchParams`, so it renders on every request: a search is the visitor's own words and cannot be prerendered. Nothing else about it is loosened: its reads still go through `cmsGet` with `force-cache` and `searchTags()`; it exports no `revalidate`, `dynamic` or `generateStaticParams`, reads no other request-time API, and has no `loading.tsx` and no Suspense boundary; it never redirects and never answers a 404, so it never renders `DataNotFound` (whose 404 holds only on an ISR route) and answers every state, a page out of range included, with a 200. `test/route-segments.test.ts` pins all of that and fails on a second dynamic route: adding one needs its own amendment to ADR 0043 and a line here first.
- Filters and pagination are path segments, never `searchParams`, with one topic and one type at a time. The search page's `q` and `page` are the one query string, because a search is not a path.
- A page that can redirect or 404 decides before anything renders, outside any Suspense boundary, in the page and in `generateMetadata` (`resourceForRequest` in `lib/redirects.ts`, `pageForRequest` in `lib/page-request.ts`). A redirect is thrown there; a 404 is returned as a not-found decision, which the page answers with `<DataNotFound />` (`components/DataNotFound.tsx`) and `generateMetadata` with `NOT_FOUND_METADATA`. Never call `notFound()` from a route or from `generateMetadata`: outside a Suspense boundary it sends Next.js's empty `__next_error__` document, and ISR stores it. `DataNotFound` sets the 404 only because the routes are ISR, so the search page, which is not, never renders it. A listing never redirects; it answers `DataNotFound` or a 200.
- A 404 decided from the path alone comes from `proxy.ts`, a rewrite to `/404` with `status: 404` (needed on Vercel, where a rewritten static file is otherwise a 200), decided in `lib/path-decision.ts` by the routes' own checks in `lib/routes.ts`, never by a second copy of them.
- Never send a permanent redirect a browser may keep. Path-only redirects come from `proxy.ts` with `no-store`; `proxy.ts` never reads the data layer. Data-dependent redirects come from the pages, are stored, and rely on the `headers()` rule in `next.config.ts` / `lib/route-headers.ts`.
- Every path and tag is built by the functions in `lib/routes.ts` and `lib/tags.ts`; every slug goes through `canonicalSlug`.
- On the CMS, anonymous REST responses the front end reads carry `NoCacheHeader`'s no-cache header, errors included, so the Data Cache stays the only HTTP cache.

The model, what each route stores, the cache key, the not-found pages, the measurements and the known costs: `docs/architecture/caching.md`. The decisions: ADRs 0024, 0025, 0040 and 0043.
