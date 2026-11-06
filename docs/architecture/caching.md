# Caching, URLs and redirects

For a contributor changing caching, data fetching, URLs or redirects on the front end, or the REST cache headers on the CMS. The decision is [ADR 0043](../adr/0043-fetch-cache-with-tags-without-cache-components.md) (the caching model) with [ADR 0024](../adr/0024-type-paths-mirrored-on-both-sites.md) and [ADR 0025](../adr/0025-redirects-are-computed-308s-with-no-store.md) (URLs and redirects). How a revalidation request reaches the route is in [revalidation.md](revalidation.md).

## The model

- **One HTTP cache.** Every CMS read is a `fetch` with `cache: "force-cache"` and `next: { tags, revalidate }` through the wrapper in `apps/web/lib/wp/fetch.ts`, so it lives in the Next.js Data Cache, which persists across deployments and instances. Varnish and Cloudflare sit between the front end and WordPress, so the plugin's `NoCacheHeader` puts `Cache-Control: no-cache, must-revalidate, max-age=0` on every anonymous response from the routes the front end reads, errors included: a copy cached upstream would survive a revalidation, and a 404 is as cacheable as a 200. Verified 2026-11-05 that the header does not stop the Data Cache from storing the response (`e2e/revalidate.spec.ts`). No Cache Components, no `'use cache'`, no `unstable_cache`.
- **On-demand first, ISR as the safety net.** The revalidate route clears tags and paths when the CMS says so. Every fetch also revalidates after `CMS_REVALIDATE_SECONDS` (one hour), the only thing that brings a page back in step after a send that failed, since the plugin never retries. Pages that set a route `revalidate` write the same number as a literal, because Next.js reads segment config statically.
- **A CMS request times out** after `CMS_TIMEOUT_MS`. Errors become `null` (a named 404 or 401, so `notFound()`), `NO_SUCH_PAGE`, or a `CmsError` that never names the CMS origin. Redirects from the CMS are refused, not followed. A collection is parsed one item at a time, with the threshold in `LIST_FAILURE_MIN_ITEMS`; the docblocks in `fetch.ts` hold the rules.
- **The build never needs the CMS.** Every route is ISR with `generateStaticParams` returning `[]`, so `next build` renders nothing from WordPress and a preview build cannot fail for a CMS reason. The deploy order (CMS first, then the front end) is what keeps the first renders correct. The library's own path, `/resources/`, is the optional catch-all `app/resources/[[...rest]]/page.tsx` for that reason: a route with no dynamic segment is prerendered at build whatever `generateStaticParams` says. Static and dynamic siblings win over a catch-all, so the page serves `/resources/` alone.
- **The Data Cache stores only 200s.** A miss by slug is a 200 with an empty list and is cached under its tags; a miss by ID and a resolve miss are a 404 or 401 and are asked again on every render. The page route answers a miss with a 200 and `page: null` for the same reason.

## Tags, and what each event clears

The tags are `resources`, `terms`, `resource:{slug}`, `topic:{slug}`, `type:{slug}` and `pages`. The rules are code in `apps/web/lib/tags.ts`, whose docblock is the full statement; `test/tags.test.ts` writes each fetch's tags out by hand and checks the functions against them.

- **A resource event** clears `resources`, `resource:{slug}`, `type:{t}` and each `topic:{p}`, and the paths `/resources/`, the resource's page, its type listing, each topic listing and each type-plus-topic listing, for both its current state and its `previous` state. Refresh and remove clear the same things; the refetch decides what is shown.
- **A term event** clears `resources`, `terms` and `topic:{slug}` or `type:{slug}` for the current and the previous slug, and the paths `/resources/` and the term's own listing for each slug.
- **A page event** clears `pages` and the paths named at the top level and in `previous`. It clears nothing of the library's, and no resource or term event clears `pages`.
- **The union rule.** Every event invalidates the union of its current and previous state; the route never diffs the two. That is what lets a stored redirect at an old URL and a stored 404 at a new one be cleared by the same event that made them wrong.
- **`terms`** is produced by term events only and carried by every fetch that embeds or lists terms, so a term rename reaches every page that shows the name (every listing, every resource page, the filter bar), which the event cannot name. Term events keep `resources` too, because the resolve route answers with the type slug.
- **Pagination is covered by tags only.** `…/page/{n}/` is never revalidated as a path: an event cannot say how many pages a listing has, and every page of a listing fetches with the same tags as its first page.

**Fetch tagging rule.** Tags are fixed before the request, from the URL and its parameters, never from the response, so a miss is cached under the tags a later publish clears. Next.js keys a cached fetch by its URL, method and headers, not its tags, so two pages that fetch one URL share one entry under whichever page's tags came first; a tag that depends on the calling page (the type segment a resource page was reached under) is never put on a shared URL. The fetches whose result can change with any resource carry `resources`: the related section, the featured list, and the filter bar's term lists, whose counts WordPress updates on every publish and trash without a term event.

**The canonical slug form.** A slug goes into a path or tag in one form, `canonicalSlug` in `lib/routes.ts`: existing escapes kept, every character a path segment does not allow percent-encoded as UTF-8, and the whole result lower-cased, which is WordPress's own form. The reserved type slugs are checked in any case. `slugProblem` also rejects a lone surrogate, a dot segment, a canonical form over 200 characters (Next.js drops a tag longer than 256 characters with only a warning), and any escape of a character Next.js decodes in params. The front end's readers are therefore stricter than the shared schema; the comment on `slugSchema` in `lib/wp/schemas/common.ts` lists the differences.

## What each route stores

All three kinds of route are ISR: `export const revalidate = 3600` as a literal, a `generateStaticParams` returning `[]`, no `connection()`, `headers()`, `cookies()` or `searchParams`, no `force-dynamic`, and no `loading.tsx`. The unit tests `test/listing-routes.test.ts`, `test/resource-route.test.ts` and `test/page-route.test.ts` pin that. A route renders on its first request, stores what it answered under the tags of the fetches that decided it, serves it from the route cache (`x-nextjs-cache: HIT`) until an event or the interval clears it, and never stores a 500.

- **The listings** (`app/resources/**`, eight routes over `components/ListingPage.tsx`): a 200, or a stored 404 for an unknown term or a page past the end, cleared by the term `create` or the publish that adds a page. An empty filter combination where both terms exist is a 200. A listing never redirects.
- **The resource page** (`app/resources/[type]/[slug]/`): `resourceForRequest` in `lib/redirects.ts` runs before anything renders and returns the resource, calls `permanentRedirect()` to the canonical path computed in one step, or `notFound()`. The 200, the 308 (a wrong type, an old slug found through resolve) and the 404 are all stored. Measured 2026-11-06: a type change turns the stored 200 at the old URL into a 308 and the stored 308 at the new URL into a 200, and the change back reverses both; a rename turns a stored 404 at the new slug into the page and the stored 200 at the old slug into a 308; an unpublish turns the stored 200 into a 404. An unknown slug costs the CMS one slug lookup and one resolve request per distinct URL per interval.
- **The pages catch-all** (`app/[[...path]]/`): `pageForRequest` in `lib/page-request.ts` decides the same way, under the `pages` tag. The welcome page is stored at `/` when no front page is set; the front page's own slug is a stored 308 to `/`; a wrong parent with a unique slug is a stored 308 to the page's path. A redirect goes out only after the target's own lookup has answered the same page at that path, so two cache entries that disagree give a 404 rather than a loop.

**The decision runs before streaming begins.** Once a Suspense boundary or a `loading.tsx` has flushed, Next.js can only send a 200 with a meta refresh for a redirect, and a 200 for `notFound()`. `generateMetadata` calls the same decision to share the memoised fetches, but cannot send the status itself: a page and its `generateMetadata` make one CMS request between them (`lib/wp/fetch.ts` memoises per render with React's `cache`).

## Redirects

**Rule: never send a permanent redirect a browser may keep.** Chromium gives a 301 or 308 with no cache header an infinite freshness lifetime, so with a stored redirect table and header-less 301s, webinar to podcast to webinar loops with `ERR_TOO_MANY_REDIRECTS`. Every redirect here is computed from the current state, sent in a single hop to a URL that answers 200, and carries a cache header.

- **From `proxy.ts`, decided from the path alone**, with `Cache-Control: no-store`: an upper-case letter in any segment, in any script (decoded, NFC, lower-cased, re-encoded in lower-case hex), a decoded escape of a character Next.js decodes in params, a repeated slash, and a trailing `/page/1/` on a listing. The rules are in `lib/canonical-path.ts`; the matcher is every `/resources/**` path plus any path with an upper-case letter, a `%` or `//`, outside `/api/`, `/media/` and `/_next/`, so a canonical page path never runs it. The proxy never reads the data layer: its `fetch` is not the Data Cache's, and a CMS request there would reach the CMS on every matched request.
- **From the ISR pages, computed from data**, stored and cleared by events: a wrong type segment, an old slug, a wrong parent, the front page's own slug. Next.js sends a stored response with `s-maxage` alone, which a browser ignores, so a stored 308 would reach a browser with no freshness information. The `headers()` rule in `lib/route-headers.ts` puts `public, max-age=0, must-revalidate` on every response of the resource page and the pages catch-all, the header Vercel's CDN sends browsers anyway; the listings keep Next.js's header, because their only redirects come from the proxy. The rule cannot vary by status, so the 200 and the 404 get it too.
- **Next.js's own trailing-slash 308** carries no cache header and is reached by neither the proxy nor `headers()`. That is harmless: `/path` to `/path/` is a function of the URL alone and never changes. A slashless non-canonical path takes two hops.
- **`/Resources/…`** is a case redirect to `/resources/…` since 2026-11-06; before that it was a 404 by design.

**The cache key.** Next.js stores a runtime ISR entry under `.next/server/route-cache/APP_PAGE/{route hash}/$/{decoded path}`: per route, but by the decoded path, so `/%41bout/` and `/About/` share a key, and on a case-insensitive file system (macOS, where the e2e suite runs) so do `/About/` and `/about/`. Measured on the pages catch-all with no proxy: a request for `/Company/` before any for `/company/` stored the 308 to `/company/` under that key, and `/company/` then redirected to itself. That is why the proxy runs on every path that can need a redirect, before any route. What Vercel keys on is unmeasured; the proxy makes it moot.

## Lab notes

Everything below was measured under `next start` against the e2e mock CMS on Next.js 16.4.5, with `curl` and raw headers unless stated. Nothing has been measured on Vercel's CDN.

**2026-11-04, browser redirect caching.** A Playwright test across Chromium 156, Firefox 157 and WebKit 27.2: Chromium caches a header-less 308 indefinitely and fails the webinar to podcast to webinar round trip; with `no-store`, `no-cache` or a `max-age`, all three engines asked the server again. Engine source agrees: Chromium's `GetFreshnessLifetimes` gives 301 and 308 `TimeDelta::Max()` unless a header overrules it; Firefox gives 0 heuristic freshness without `Last-Modified`; WebKit gives a 301 365 days and a 308 zero, and drops redirects marked `no-store`, `no-cache` or `must-revalidate`.

**2026-11-05, how a redirect can be sent.** `permanentRedirect()` from a dynamic render is a 308 with `private, no-cache, no-store, max-age=0, must-revalidate`, stored nowhere. From an ISR route it is treated as a page: prerendered or rendered once, then served `HIT` with `s-maxage=3600, stale-while-revalidate=…` and no `max-age`, and cleared by the revalidation event through the entry's tags. Making only the redirecting render dynamic in an ISR route (`connection()`, a `no-store` fetch) is a 500 at runtime (`DYNAMIC_SERVER_USAGE`) for every path not prerendered, and `generateStaticParams` returning `[]` with `connection()` is a 500 on every request. A `permanentRedirect()` inside a Suspense boundary or under a `loading.tsx` is a 200 with a meta refresh. `proxy.ts` can set status and headers freely, but its `fetch` is not the Data Cache's: two proxy calls for one slug made two CMS requests. A Route Handler cannot share a segment with a page. A `headers()` rule applies to every response of a path, keeps the route cache (`HIT`), and does not reach the built-in trailing-slash 308. Next.js normalises `params` before a page runs: `%e6%97%a5` arrives as `%E6%97%A5`, `%41bc` as `Abc`, `foo%2Dbar` as `foo-bar`; a malformed escape is a 500 before any page runs.

Per-request cost, 300 sequential loopback `GET`s each, mean and p95:

| Response | Mean | p95 |
|---|---|---|
| ISR 200, `HIT` | 0.83 ms | 1.00 ms |
| ISR 308, stored | 0.72 ms | 0.91 ms |
| Dynamic 200 rendered from the Data Cache | 1.62 ms | 2.39 ms |
| Dynamic 308 rendered from the Data Cache | 1.80 ms | 2.41 ms |
| Route Handler 308 | 0.91 ms | 1.15 ms |
| Proxy 308, no data | 0.44 ms | 0.55 ms |
| Proxy with the data layer, one CMS request each | 0.93 ms | 1.14 ms |
| Static page, no proxy / through the proxy | 0.48 ms / 0.61 ms | 0.61 ms / 0.73 ms |

The resource page was first built as a dynamic render (`force-dynamic`, `connection()`), the only mechanism measured that sends every redirect with `no-store`. It was reversed on 2026-11-06 because of what it costs on Vercel: a function invocation, a cold start and a region's time to first byte on every view, no CDN-cacheable HTML, and one uncached resolve request per page view for every unknown slug.

**2026-11-05, the proxy's cost** on the listings, the same build with `proxy.ts` present and removed: about 0.15 ms on every listing hit (0.42 to 0.61 ms mean for `/resources/`), a redirect in about 0.19 ms with no data read, and nothing on an unmatched route.

**2026-11-06, the resource page as ISR.** The wire headers of the route before and after:

| Response | Dynamic (before) | ISR, no rule | ISR with the `headers()` rule |
|---|---|---|---|
| 200, 308 and 404 | `private, no-cache, no-store, max-age=0, must-revalidate`, never stored | `s-maxage=3600, stale-while-revalidate=…`; `MISS` then `HIT` | `public, max-age=0, must-revalidate`; `MISS` then `HIT` |
| 500, `CmsError` | `no-store` | unchanged, never stored | unchanged |
| 308 from `proxy.ts` | `no-store` | unchanged | unchanged |

A freshly rendered ISR 308 (`MISS`) carries `location` twice with the same value and the stored copy once; the e2e helpers assert every `Location` agrees before reading the first. The build prerenders nothing. The pages catch-all got the same treatment the same day, measured in `e2e/pages.spec.ts`. The redirect, storage and 404 specs were also run once under WebKit: nothing about a redirect or a stored response differed.

**Expected on Vercel, unmeasured.** The CDN should store the resource page, its 308 and its 404 as it stores a listing, purge them on `revalidateTag` and `revalidatePath`, and send browsers `public, max-age=0, must-revalidate` whether from the rule or from its own handling of `s-maxage`. The checks to run on a preview deployment are in the [deploy runbook](../runbooks/deploy.md#verifying-on-a-vercel-preview).

## Known costs

- **Any resource event re-renders every stored listing.** Each listing renders the filter bar, whose two taxonomy lists carry `resources` as well as `terms` so each term's count stays right. A `publish` of one webinar marks every stored listing stale, not only the ones it is on. The re-render is cheap, since the listing fetches of untouched listings keep their own tags and stay cached. If it ever shows in function time, the fix is to split the term-count lists from `resources`.
- **Every distinct junk path stores its own 404.** A 404 from a listing, the resource page or the pages catch-all is stored for up to the interval like a 200, and each costs one CMS lookup first. A crawler or an attacker can mint unlimited distinct paths, each a stored entry and a CMS request. The bound belongs at the edge, a Vercel Firewall rate-limit rule, not in the app: a 404 decided without a request is stored all the same. Tracked in [issue #48](https://github.com/Colbitron/resource-hub-wp/issues/48).
- **The first request to a cleared page waits for the CMS.** `{ expire: 0 }` makes the next request a miss that waits for fresh data, chosen so a removal never serves one more stale render.
- **The HTML of a data-decided 404 is empty.** A `notFound()` decided by data is sent as Next.js's empty `__next_error__` document, with `app/not-found.tsx` arriving on hydration; ISR stores that same document. Pinned in `e2e/errors.spec.ts`, tracked in [issue #46](https://github.com/Colbitron/resource-hub-wp/issues/46).
- **Between the CMS deploy and the front-end deploy**, a page change reaches the front end through the hourly interval only when the front end cannot yet read a new event type; additive changes have no gap.
