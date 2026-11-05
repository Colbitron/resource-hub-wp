---
status: proposed
date: 2026-11-05
---

# The data layer's fetches: a one-hour ISR interval, a ten-second timeout, and slugs normalised but not redirected

Every CMS read goes through one wrapper in `apps/web/lib/wp/fetch.ts`, which opts into the Data Cache with `cache: 'force-cache'`, the request's tags ([ADRs 0043](0043-fetch-cache-with-tags-without-cache-components.md), [0046](0046-which-tags-and-paths-each-event-revalidates.md)) and `next: { revalidate: CMS_REVALIDATE_SECONDS }`. This records the values and rules that wrapper and its fetchers fix.

## The ISR interval is 3600 seconds

On-demand revalidation is the primary path, and the interval is the safety net. The plugin sends each batch once and does not retry ([ADR 0013](0013-three-second-timeout-and-no-retries.md)), so after a send that failed (the front end down, a timeout, a wrong secret) the interval is the only thing that brings the pages back in step. An hour bounds that staleness to something an editor will tolerate while asking each cached URL of the CMS at most once an hour, in the background, on a 2 GB server that has no cache in front of its REST responses ([ADR 0023](0023-next-data-cache-is-the-only-http-cache.md)).

This is a default chosen while the project owner was away on 2026-11-05 and is pending their review; hence `proposed`. It is one constant, `CMS_REVALIDATE_SECONDS`. Pages that set a route `revalidate` must write the same number as a literal, because Next.js reads segment config statically and cannot import it.

## A CMS request times out after ten seconds

`CMS_TIMEOUT_MS` is 10,000, covering the headers and the body. A healthy WordPress answers these reads in well under two seconds even with a cold object cache, so ten gives a slow but working CMS five times that, while a hung one fails the render with a `CmsError` long before a Vercel function's duration limit instead of holding the function open. A resource page makes at most three requests in sequence on a cold cache, so its worst case stays near thirty seconds.

Two consequences of using an `AbortSignal` for it. Next.js does not memoize a fetch that carries a signal, so the wrapper memoizes per render with React's `cache` instead. Next.js's lock on each Data Cache key already makes concurrent cold reads of a 200 one request, but an answer it does not cache (a by-ID miss, a resolve miss) would reach the CMS once per call without the memoization; the e2e suite checks that case. And Next.js drops the signal when it refreshes a stale entry in the background, so that refresh is not bounded; the visitor is served the stale entry meanwhile.

## Errors map to three plain outcomes

A 404 the fetcher names (core's `rest_post_invalid_id`, the plugin's `resource_hub_not_found`) and core's 401 `rest_forbidden` for an unpublished post become `null`, and the page calls `notFound()`. Core's 400 `rest_post_invalid_page_number` becomes `NO_SUCH_PAGE`. Everything else throws a `CmsError` whose message names the endpoint's path under `WP_API_URL` and never the CMS origin: any other status (a 404 `rest_no_route` included, which means the plugin or the route is missing, not the resource), a redirect, a timeout, a network error (named by its code, because Node's message prints the address), a body that is not JSON, or a body the reader schema refuses. As a backstop the message is scrubbed of each configured CMS host, both with its port and as a bare hostname.

Mapping core's 401 `rest_forbidden` on a by-ID read to a miss is right for core, which answers that way for a draft or a trashed post. The trade-off: a REST-lockdown plugin on the CMS that answers anonymous readers with the same 401 would turn every by-ID read into a 404 page, while the list and slug reads, which treat any 401 as an error, throw and fail loudly.

A slug read that comes back with resources but none with the slug asked for throws a `CmsError` (reason `schema`) rather than being a miss. Core's `slug` filter returns only exact matches, so other resources mean the filter was dropped on the way (a plugin, a proxy) and the answer is to a different question; a miss would make every resource page a 404 and hide that, as the by-ID read already refuses a body for another ID. An empty list is still a miss.

## Redirects from the CMS are refused, not followed

Every CMS fetch sets `redirect: "error"`. Followed silently, a redirect (http to https, a `www` host, a CMS that moved) would put the final 200 in the Data Cache under the original URL and leave a `WP_API_URL` that needs fixing looking healthy, at the cost of a hop on every uncached read. Refused, it fails the render with a `CmsError` of reason `redirect` and the message "the CMS answered with a redirect; check WP_API_URL". A 3xx that reaches the reader anyway (one without a `Location`) gets the same reason. The REST API answers these reads directly, so a redirect is always a configuration error to fix, never a route to take.

## Mixed-case and other non-canonical URLs redirect; the data layer only normalises

`canonicalSlug` lower-cases a slug and percent-encodes it as WordPress stores it, so `/resources/Webinar/` fetches the same data as `/resources/webinar/`, and every fetcher sends and tags the canonical form. The data layer does nothing more: it never decides a URL is wrong. The policy for the page pull requests is that a path whose type, topic or slug segment is not in canonical form gets a single-hop 308 to the canonical URL with `Cache-Control: no-store`, the same response as a wrong type segment ([ADRs 0025](0025-redirects-are-computed-308s-with-no-store.md), [0035](0035-type-paths-with-a-computed-no-store-308.md)), so each page has one URL. That redirect is built in the redirect-mechanism pull request; until then a non-canonical URL renders the canonical page's content.

*Amended 2026-11-05, with the redirect mechanism ([ADR 0035](0035-type-paths-with-a-computed-no-store-308.md)'s amendment):* the percent-encoding half of this rule cannot be enforced by a page. Next.js normalises `params` before the page runs: the hex of an escape arrives upper-cased whatever was sent (`%e6%97%a5` and `%E6%97%A5` both arrive as `%E6%97%A5`), and escapes of unreserved ASCII characters arrive decoded (`%52esource` as `Resource`). So the redirect rule is: an upper-case ASCII letter outside an escape redirects to the lower-case canonical URL; the hex case of an escape is treated as canonical, or the redirect would point at itself. The data layer's own canonical form is unchanged.

## The filter bar reads at most 1,000 terms a taxonomy

`listTerms` pages through a taxonomy a hundred at a time and stops after ten pages. Past 1,000 terms something is wrong with the CMS, but throwing would fail every listing page, whose filter bar needs the list. So it returns the first 1,000 by name and logs a `console.warn` that names the taxonomy and not the CMS origin; the bar is missing terms until the CMS is fixed.

## Considered options

- **A shorter interval (five minutes).** Repairs a failed send sooner, at twelve times the background load on a CMS with no cache in front of it. Rejected for now; the value is one constant.
- **A day, or no interval (`false`).** A failed send would leave a page wrong for a day or until the next edit to it. Rejected while sends are never retried.
- **No timeout, relying on the function's duration limit.** A hung CMS would hold every rendering function for minutes. Rejected.
- **Treating any 404 as a miss.** A missing route would make every page a 404 rather than an error, hiding a broken deploy. Rejected: misses are named by status and code.
- **Fetching with the slug as given and redirecting in the data layer.** The data layer has no response to redirect with, and two forms of one slug would be two cache entries. Rejected.
- **Following CMS redirects (`fetch`'s default).** Works through a misconfigured `WP_API_URL` while caching each answer under a URL that never served it. Rejected for `redirect: "error"`.
- **Throwing past 1,000 terms.** Visible, but takes every listing page down with it. Rejected for the cap and a warning.

## Consequences

- The Data Cache stores only 200s. A miss by slug is a 200 with an empty list and is cached under its tags; a miss by ID and a resolve miss are a 404 or 401 and are asked again on every render.
- A 200 whose body fails the schema is cached like any other 200, so the render keeps throwing until the interval passes or an event clears its tags. ISR keeps serving the last good page meanwhile.
- Fixing the CMS does not heal such a cached bad 200 before it expires: the Data Cache does not know the CMS changed. A test revalidation from the plugin's status page clears most of them, because every event invalidates `resources` ([ADR 0046](0046-which-tags-and-paths-each-event-revalidates.md)), which the library listing, the by-ID, related, resolve and flag reads and the filter bar's term lists all carry. What it misses are the reads tagged only by their own slug or term (another resource by slug, another type's or topic's listing and term lookup); those wait for an event that names them, or for the interval.
- Some costs are left for the page pull requests to absorb. An unknown slug costs a cached empty-list read (and a resolve request, which is not cached because its miss is a 404) per distinct URL a visitor or crawler tries; an out-of-range page number costs one uncached 400 from the CMS per request. The pages decide how to bound these (static params, the route's own caching of a `notFound()`), not the data layer.
- A change to the interval or the timeout is a change to one constant and to this record.
