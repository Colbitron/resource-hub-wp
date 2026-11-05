---
status: accepted
date: 2026-11-04
---

# A resource lives at `/resources/[type]/[slug]/`, and any other URL for it gets a computed 308 with `no-store`

A single resource's URL includes its one type, mirroring the CMS's permalink ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)): a subfolder per type gives the library a visible hierarchy for search. The slug is the identity and the type segment is checked. When the type in the URL is not the resource's current type, the page sends a 308 to the canonical URL, computed from the current data, in a single hop to a URL that always answers 200, with `Cache-Control: no-store`. When the slug matches no current resource, the page calls the CMS's `GET /resource-hub/v1/resolve?slug=…` and, if it finds the resource under an old slug, sends the same kind of 308; otherwise it returns a 404. The old path is revalidated as well, so the edge cache stops serving it.

A type can change and change back. With a stored redirect and header-less permanent redirects, browsers keep the first redirect and loop. A Playwright test on 2026-11-04 across Chromium 156, Firefox 157 and WebKit 27.2 showed it: Chromium caches a header-less 308 indefinitely and fails webinar → podcast → webinar with `ERR_TOO_MANY_REDIRECTS`, while with `no-store`, `no-cache` or a `max-age` all three engines asked the server again. Chromium's `GetFreshnessLifetimes` gives 301 and 308 `TimeDelta::Max()` unless a header overrules it; Firefox gives 0 heuristic freshness without `Last-Modified`; WebKit gives a 301 365 days and a 308 zero, and drops redirects marked `no-store`, `no-cache` or `must-revalidate`. Google asks for permanent redirects only "when you're sure that the redirect won't be reverted".

The requirement is fixed: a single-hop 308 with `Cache-Control: no-store`. The mechanism that sends it is chosen and verified in slice 3. Next.js's `permanentRedirect()` documents no way to set response headers, and while a response is streaming it falls back to a meta refresh, so slice 3 checks what Vercel actually sends for it and otherwise uses `proxy.ts` or a route handler that sets the status and headers itself.

## Considered options

- **`/resources/[slug]/`.** Rejected: no hierarchy in the URL.
- **A stored redirect table with plain 301s.** Rejected: the loop above.

## Consequences

- Rule: never send a permanent redirect without a cache header.
- A Playwright round-trip test changes a type, changes it back, and follows both URLs.
- The current-slug lookup comes first; resolve is called only on a miss, so renamed resources cost one extra request and current ones none.
- A type re-slug in the CMS needs no redirect table: every resource page under the old type segment redirects through the same check.

## Amendment, 2026-11-05: the mechanism, measured, is a page that renders on every request

The requirement above is unchanged. This records what Next.js 16.4.5 actually sends for each way of redirecting, measured under `next start` with throwaway routes against the e2e mock CMS (ports 3370 and 4070), `curl` and raw headers, and the mechanism chosen from it. The decision itself is `apps/web/lib/redirects.ts`; the test-only page `/fixtures/redirect/[type]/[slug]/` and `apps/web/e2e/redirects.spec.ts` prove it.

### What was measured

**`permanentRedirect()` from a dynamic render** (a dynamic segment without `generateStaticParams`, or any page after `connection()`): `HTTP/1.1 308 Permanent Redirect`, `location: /spike/target/`, `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`, `Content-Type: text/html; charset=utf-8`, no `x-nextjs-cache`. The same on every request; nothing is stored.

**`permanentRedirect()` from an ISR route** (`export const revalidate = 3600` with `generateStaticParams`): the redirect is treated as a page. A param that redirects at build time is prerendered as a 308 (`●` in the build output; its `.meta` file holds `"status": 308`, the `location` and the fetch's tags, `resource:{slug}` and `terms`). It is served as `HTTP/1.1 308`, `x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`, `Cache-Control: s-maxage=3600, stale-while-revalidate=31532400`. A param first seen at runtime is rendered once (`MISS`) and then served the same way (`HIT`). So ISR does store the redirect. The revalidation event for a type change does clear it, through the tags on the entry: after webinar to podcast plus the event, the old URL re-rendered (`MISS`) as a 308 to the new one, and after the change back it re-rendered as a 200; inside Next's own cache the round trip holds. The header is the problem: `s-maxage` only, no `max-age`, no `no-store`. Chromium gives a 308 with neither `max-age` nor `Expires` an infinite freshness lifetime (the evidence in [ADR 0025](0025-redirects-are-computed-308s-with-no-store.md)), so a browser would keep it, and a CDN keeps it for the hour unless the event reaches it. What Vercel's CDN forwards to browsers for an ISR response was not measured here.

**Making only the redirecting render dynamic in an ISR route** (`await connection()`, a `cache: "no-store"` fetch, or a `next: { revalidate: 0 }` fetch before `permanentRedirect()`): at build, the redirecting param is left out of the prerender with no error, and from then on that param is rendered dynamically for ever, served `private, no-cache, no-store` even once the data makes it a 200. At runtime it fails: a path that was prerendered (the old URL, re-rendered after a type change) and a path never seen at build (`generateStaticParams` returning `[]`) both answer `HTTP/1.1 500 Internal Server Error` with the digest `DYNAMIC_SERVER_USAGE`; six 500s across the three variants, and `generateStaticParams` returning `[]` with `connection()` on every render is a 500 on every request. The build-time bail-out is a documented path; the runtime one is not.

**Guarding the page against an added `generateStaticParams`** (re-measured after review, same setup, 2026-11-05). Seven throwaway copies of the fixture page, each asked for a canonical URL, a wrong-type URL and a URL never seen at build, twice each:

| Route segment config | `generateStaticParams` | Build | Runtime |
|---|---|---|---|
| `connection()` (no segment config) | none | `ƒ` | 200, 308, 404, all `private, no-cache, no-store, max-age=0, must-revalidate` |
| `connection()` | lists the canonical and the wrong-type param | `ƒ`: both params bail out at build | as above |
| `connection()` | returns `[]` | `●` | **500 on every request** (`DYNAMIC_SERVER_USAGE`, six of six) |
| `dynamic = "force-dynamic"`, with or without `connection()` | lists both params | `ƒ` | 200, 308, 404, all with the `no-store` header above |
| `dynamic = "force-dynamic"` and `connection()` | returns `[]` | `●` | as above: no 500 |
| `revalidate = 0` and `connection()` | lists both params, or returns `[]` | `ƒ`, or `●` | as above: no 500 |

The Data Cache survives both `force-dynamic` and `revalidate = 0`, because the data layer asks for `cache: "force-cache"` on every fetch: 20 renders of a new resource's canonical URL and 10 of its wrong-type URL made one CMS request between them, in each of three routes (`connection()` alone, `force-dynamic`, `revalidate = 0`). An unknown slug is not cached: five requests for one made one CMS slug read, cached as an empty list, and five resolve requests, one per request, because resolve's miss is a 404 and the Data Cache stores only 200s ([ADR 0049](0049-data-layer-fetch-policy.md)).

**When streaming has begun**: a `permanentRedirect()` inside a `<Suspense>` boundary, or in a page under a `loading.tsx`, is `HTTP/1.1 200 OK` whose body carries `<meta id="__next-page-redirect" http-equiv="refresh" content="0;url=/spike/target/"/>` and the RSC payload `NEXT_REDIRECT;replace;/spike/target/;308;`. No 308 reaches the wire. The decision must therefore run before anything is rendered, and the resource route must not have a `loading.tsx`.

**`proxy.ts`** (Next 16's middleware): runs on the Node.js runtime (`process.env.NEXT_RUNTIME` was `nodejs`; the docs say the `runtime` option is not available in a proxy file). `NextResponse.redirect(url, 308)` with the header set gives `HTTP/1.1 308`, `cache-control: no-store`, `location: /spike/target/`, `Refresh: 0;url=/spike/target/`. It can import and run the data layer: `getResourceBySlug` returned the resource. But its `fetch` is not Next's patched one: two proxy calls for one slug made two CMS requests, where twenty dynamic page renders from the Data Cache made none. It runs before the route cache on every matched request: a prerendered page kept `x-nextjs-cache: HIT` and still carried a fresh `x-proxy-time` header each time. Cost locally, 300 sequential requests: a static page 0.48 ms mean without the proxy and 0.61 ms through it; a proxy redirect with no data 0.44 ms; the proxy with the data layer 0.93 ms against a loopback mock, which on the hosted CMS would be one CMS round trip per page view (ADR 0023: no cache in front of the REST API).

**A Route Handler** sets status and headers freely (`HTTP/1.1 308`, `cache-control: no-store`, `location`; 0.91 ms), but a `route.ts` and a `page.tsx` cannot share a segment: the build fails with `Conflicting route and page at /spike/handler/[type]/[slug]`. The resource path would have to be a handler that renders the page itself, with no layout, metadata or streaming.

**`headers()` in `next.config.ts`**: a `Cache-Control: no-store` rule on a path applies to every response of that path. The ISR 200 kept `x-nextjs-cache: HIT` and got `Cache-Control: no-store`; the page's 308 got `no-store` in place of Next's dynamic header. It does not reach the built-in trailing-slash 308: that response carried neither the rule's `x-config-header` nor any `Cache-Control`, and the proxy did not run for it either.

**The built-in trailing-slash 308**, in full: `HTTP/1.1 308 Permanent Redirect`, `location: /fixtures/cards/`, `Refresh: 0;url=/fixtures/cards/`, `Date`, `Connection: keep-alive`, `Keep-Alive: timeout=5`, `Transfer-Encoding: chunked`. No `Cache-Control`, no `Vary`. The same for `POST /api/revalidate`.

**How the page sees a segment**: Next.js normalises `params` before the page runs. `%E6%97%A5` and `%e6%97%a5` both arrive as `%E6%97%A5`; `%41bc` arrives as `Abc` and `foo%2Dbar` as `foo-bar`; `a%2Fb`, `a%20b` and `100%25` arrive as sent; `%2e%2e` is collapsed by the router; a malformed escape (`100%`) is a 500 from Next.js before any page runs. The page cannot tell the two hex cases apart, so a redirect from one to the other would be a redirect to itself.

**Per-request cost**, 300 sequential `GET`s each, loopback, mean and p95:

| Response | Mean | p95 |
|---|---|---|
| ISR 200, `x-nextjs-cache: HIT` | 0.83 ms | 1.00 ms |
| ISR 200 HIT with a config `no-store` rule | 0.74 ms | 0.94 ms |
| ISR 308, stored | 0.72 ms | 0.91 ms |
| Dynamic 200 rendered from the Data Cache | 1.62 ms | 2.39 ms |
| Dynamic 308 rendered from the Data Cache | 1.80 ms | 2.41 ms |
| Route Handler 308 | 0.91 ms | 1.15 ms |
| Proxy 308, no data | 0.44 ms | 0.55 ms |
| Proxy with the data layer, one CMS request each | 0.93 ms | 1.14 ms |
| Static page, no proxy | 0.48 ms | 0.61 ms |
| Static page through the proxy | 0.61 ms | 0.73 ms |

### What Vercel's documentation says (not measured here)

Everything above was measured under `next start`, with no CDN in front. Vercel's documentation, read on 2026-11-05, says its CDN changes the header a browser sees. From [Cache-Control headers](https://vercel.com/docs/headers/cache-control-headers), under `s-maxage`: "When `Cache-Control` is the only cache header on the response, Vercel's proxy consumes `s-maxage`. After processing it, the CDN does not include it in the final HTTP response to the client." Under "Set Cache-Control for a page": "Vercel consumes `s-maxage`, so the browser receives `cache-control: public, max-age=0, must-revalidate` instead of your value." ([CDN cache](https://vercel.com/docs/caching/cdn-cache) says the same, and lists 308 among the cacheable statuses.) The same page's priority table shows the browser getting `public, max-age=0`, without `must-revalidate`; the two are not reconciled. Neither page says how this applies to an ISR response or to a redirect in particular.

If it holds for an ISR 308, the browser gets `max-age=0` and revalidates the redirect on every request, and the only stored copy is the CDN's, which the revalidation event for the type change purges through the route's tags. That would make the ISR alternative compatible with [ADR 0025](0025-redirects-are-computed-308s-with-no-store.md)'s loop evidence, where a `max-age` was enough for all three engines to ask the server again. It would not meet this record's literal rule (`no-store`), and between the change in the CMS and the event reaching the front end the CDN would keep serving the old redirect. None of this has been measured on Vercel: the Vercel project is not set up yet ([issue #12](https://github.com/Colbitron/resource-hub-wp/issues/12)).

### The mechanism, chosen by default and pending the owner's review

`/resources/[type]/[slug]/` renders on every request: a dynamic segment with no `generateStaticParams`, `export const dynamic = "force-dynamic"`, and `await connection()` first. `force-dynamic` is what keeps it dynamic if `generateStaticParams` is ever added (the table above); `connection()` says so at the point of use. The page calls `resourceForRequest(type, slug)` from `apps/web/lib/redirects.ts` before rendering anything and outside any Suspense boundary. The function looks the slug up in canonical form through the data layer, asks the resolve route only on a miss ([ADR 0029](0029-old-slugs-resolve-through-core.md)), and returns the resource, or calls `permanentRedirect()` with the canonical path computed in one step from the CMS's current answer, or `notFound()`. Next.js then sends `HTTP/1.1 308` with `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` and stores nothing, so there is no redirect for ISR, a CDN or a browser to keep, and a type changed and changed back is answered afresh each time. The data layer's Data Cache keeps the lookups off the CMS: 30 renders, one CMS request. `decideResourceRequest` is the same decision without Next.js, for the unit tests.

Non-canonical segments: an upper-case ASCII letter outside a percent escape in either segment redirects to the lower-case canonical URL (`/resources/Webinar/Slug/`, and `%52esource`, which Next.js decodes to `Resource`); the hex case of an escape is invisible to the page and is treated as canonical, so `%E6%97%A5` renders. A slug may not hold an escape of an unreserved character, which Next.js would decode ([ADR 0049](0049-data-layer-fetch-policy.md), amended), so a redirect's target is a fixed point: `test/redirects.test.ts` checks over thousands of generated slugs and requests that following one never redirects again. A reserved or invalid type segment and an invalid slug are 404s before any lookup. When resolve names the URL that was just asked for, the slug lookup's cached miss is stale next to it; that is a 404 until the next event, not a redirect to itself.

"Single hop" holds from a URL with its trailing slash. A request without one whose segment is also non-canonical (`/resources/Webinar/slug`) takes Next.js's built-in slash 308 first and then the computed one: two hops.

This is the contract-literal choice: it is the only mechanism measured that sends every redirect with `no-store`, in one hop, computed from the CMS's current answer. It is the default while the project owner reviews the trade-off below, not a settled decision.

### What it costs on Vercel

Locally the price is small: 1.6 ms a dynamic render against 0.8 ms for an ISR hit. On Vercel it is a different kind of cost, none of it measured yet:

- **A function invocation on every view.** Every page view and every crawler hit on a single resource runs a function and pays for its CPU time, where ISR would serve the stored page from the CDN.
- **Time to first byte from the function's region**, not the nearest edge, plus a cold start when no instance is warm.
- **Misses reach the CMS on a visitor's request.** After a revalidation clears a tag, the next render fetches from a CMS that has no cache in front of its REST API ([ADR 0023](0023-next-data-cache-is-the-only-http-cache.md)), where ISR would refetch in its own background regeneration.
- **No CDN-cacheable HTML** for the single-resource page.
- **The 200 carries `no-store` too**, Next.js's dynamic header. Browsers may then keep the page out of the back/forward cache; unconfirmed, as browsers differ and are relaxing this rule.
- **Each unknown slug costs one uncached resolve request per page view**, because resolve's 404 is never stored. Bots probing URLs and readers' typos therefore reach the CMS one for one. Mitigations: a Vercel Firewall rate-limit rule on `/resources/*/*/`, or a resolve route that answers a miss with a 200 and an empty body, which the Data Cache would store. The second is a contract change, so it is an option for a later pull request, not part of this one.

### Against the project's targets

`apps/web/CLAUDE.md` asks for Lighthouse mobile performance and accessibility of 95 or better on a single resource, and the root `CLAUDE.md` for good Core Web Vitals and a site shaped like "Next.js and Vercel with ISR and on-demand revalidation". The time to first byte of a dynamic single-resource page on Vercel is unmeasured, so whether this choice keeps that page at 95 is not known yet.

### Recommendation

Keep the dynamic page as the default, because it is the choice that meets the contract to the letter, and treat it as pending the owner's review. Once the Vercel project exists (issue #12), run a one-route spike on a preview deployment: an ISR route that redirects and the dynamic route, both checked with `curl -I` for the status and the `Cache-Control` the browser receives, a type change and change back followed in a browser, and a Lighthouse mobile run on each. Then decide, and amend this record with the numbers.

### Considered and rejected

- **ISR page with a plain `permanentRedirect()`.** Under `next start` the 308 is prerendered and stored with `s-maxage=3600` and no `no-store`, which a browser that receives that header keeps for ever. On Vercel the browser may instead get `max-age=0` (above), which would make it safe against the loop but not `no-store`; unmeasured. The alternative the spike will test.
- **ISR page that bails out to a dynamic render only when it redirects.** A 500 at runtime (`DYNAMIC_SERVER_USAGE`) on every prerendered path and every path not seen at build.
- **`connection()` alone as the guard.** Adequate today, but a `generateStaticParams` returning `[]` makes every request a 500. Kept, with `force-dynamic` beside it.
- **`export const revalidate = 0` in place of `force-dynamic`.** Measured to behave the same: dynamic, `no-store` on every redirect, the Data Cache kept. Not chosen because a `revalidate` export reads as an ISR interval, and [ADR 0049](0049-data-layer-fetch-policy.md) asks that a route `revalidate` be the data layer's 3600; `force-dynamic` says what is meant.
- **`proxy.ts` with the data layer.** `no-store` and single-hop, but a CMS request per page view, before the cache, on a CMS with no REST cache.
- **A Route Handler at the resource path.** Cannot share the segment with the page.
- **A `headers()` rule putting `no-store` on `/resources/:type/:slug/`, with an ISR page.** Keeps the Full Route Cache for the 200 (0.74 ms a hit) and tells every cache downstream not to keep the 308, but the 200 is then not cached by any CDN or browser either, the 308 is still stored by ISR until an event or the hour clears it, and the rule cannot be made conditional on the status. It would need its own round-trip test for the stored 308.
- **Cache Components (PPR) with the decision in the dynamic part.** Already rejected by [ADR 0043](0043-fetch-cache-with-tags-without-cache-components.md); and a redirect after the static shell is flushed is a meta refresh.

### Consequences

- The resource page has `export const dynamic = "force-dynamic"`, no `generateStaticParams` and no `loading.tsx`, and calls `resourceForRequest` first. With `force-dynamic`, adding `generateStaticParams` changes nothing on the wire (measured above); without it, a `generateStaticParams` returning `[]` would make every request a 500. A route `revalidate` with prerendered params would store the redirects; `e2e/redirects.spec.ts` asserts `no-store` and no `x-nextjs-cache` on every redirect, so it would fail.
- The e2e suite covers the fixture route `/fixtures/redirect/[type]/[slug]/`. The pull request that adds the resource page must point a spec at the real `/resources/[type]/[slug]/` route.
- The built-in trailing-slash 308 stays as Next.js sends it, with no `Cache-Control`: neither `headers()` nor the proxy reaches it. That is harmless: `/path` to `/path/` is a function of the URL alone and never changes, so a browser keeping it can never be wrong, and the slashed URL then goes through the computed check. The rule "never send a permanent redirect without a cache header" is kept for every redirect whose target can change.
- The listing pages will be ISR. Their only redirect is the canonical-form one for a mixed-case segment ([ADR 0049](0049-data-layer-fetch-policy.md)), whose target, like the slash redirect's, is a function of the URL alone; the listing pull requests decide whether to send it from the ISR page, stored but never wrong, or from a proxy matched on `/resources/:path*` with no data (0.44 ms a redirect, 0.13 ms added to every other matched request).
- `lib/wp/cards.ts` exports `resourceType`, the one rule for which resources have a URL, shared by the card mapping and the redirect decision.
