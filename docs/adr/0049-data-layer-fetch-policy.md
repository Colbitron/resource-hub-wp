---
status: proposed
date: 2026-11-05
---

# The data layer's fetches: a one-hour ISR interval, a ten-second timeout, and slugs normalised but not redirected

Every CMS read goes through one wrapper in `apps/web/lib/wp/fetch.ts`, which opts into the Data Cache with `cache: 'force-cache'`, the request's tags ([ADRs 0043](0043-fetch-cache-with-tags-without-cache-components.md), [0046](0046-which-tags-and-paths-each-event-revalidates.md)) and `next: { revalidate: CMS_REVALIDATE_SECONDS }`. This records three values that wrapper and its fetchers fix.

## The ISR interval is 3600 seconds

On-demand revalidation is the primary path, and the interval is the safety net. The plugin sends each batch once and does not retry ([ADR 0013](0013-three-second-timeout-and-no-retries.md)), so after a send that failed (the front end down, a timeout, a wrong secret) the interval is the only thing that brings the pages back in step. An hour bounds that staleness to something an editor will tolerate while asking each cached URL of the CMS at most once an hour, in the background, on a 2 GB server that has no cache in front of its REST responses ([ADR 0023](0023-next-data-cache-is-the-only-http-cache.md)).

This is a default chosen while the project owner was away on 2026-11-05 and is pending their review; hence `proposed`. It is one constant, `CMS_REVALIDATE_SECONDS`. Pages that set a route `revalidate` must write the same number as a literal, because Next.js reads segment config statically and cannot import it.

## A CMS request times out after ten seconds

`CMS_TIMEOUT_MS` is 10,000, covering the headers and the body. A healthy WordPress answers these reads in well under two seconds even with a cold object cache, so ten gives a slow but working CMS five times that, while a hung one fails the render with a `CmsError` long before a Vercel function's duration limit instead of holding the function open. A resource page makes at most three requests in sequence on a cold cache, so its worst case stays near thirty seconds.

Two consequences of using an `AbortSignal` for it. Next.js does not memoize a fetch that carries a signal, so the wrapper memoizes per render with React's `cache` instead. And Next.js drops the signal when it refreshes a stale entry in the background, so that refresh is not bounded; the visitor is served the stale entry meanwhile.

## Errors map to three plain outcomes

A 404 the fetcher names (core's `rest_post_invalid_id`, the plugin's `resource_hub_not_found`) and core's 401 `rest_forbidden` for an unpublished post become `null`, and the page calls `notFound()`. Core's 400 `rest_post_invalid_page_number` becomes `NO_SUCH_PAGE`. Everything else throws a `CmsError` whose message names the endpoint's path under `WP_API_URL` and never the CMS origin: any other status (a 404 `rest_no_route` included, which means the plugin or the route is missing, not the resource), a timeout, a network error (named by its code, because Node's message prints the address), a body that is not JSON, or a body the reader schema refuses.

## Mixed-case and other non-canonical URLs redirect; the data layer only normalises

`canonicalSlug` lower-cases a slug and percent-encodes it as WordPress stores it, so `/resources/Webinar/` fetches the same data as `/resources/webinar/`, and every fetcher sends and tags the canonical form. The data layer does nothing more: it never decides a URL is wrong. The policy for the page pull requests is that a path whose type, topic or slug segment is not in canonical form gets a single-hop 308 to the canonical URL with `Cache-Control: no-store`, the same response as a wrong type segment ([ADRs 0025](0025-redirects-are-computed-308s-with-no-store.md), [0035](0035-type-paths-with-a-computed-no-store-308.md)), so each page has one URL. That redirect is built in the redirect-mechanism pull request; until then a non-canonical URL renders the canonical page's content.

## Considered options

- **A shorter interval (five minutes).** Repairs a failed send sooner, at twelve times the background load on a CMS with no cache in front of it. Rejected for now; the value is one constant.
- **A day, or no interval (`false`).** A failed send would leave a page wrong for a day or until the next edit to it. Rejected while sends are never retried.
- **No timeout, relying on the function's duration limit.** A hung CMS would hold every rendering function for minutes. Rejected.
- **Treating any 404 as a miss.** A missing route would make every page a 404 rather than an error, hiding a broken deploy. Rejected: misses are named by status and code.
- **Fetching with the slug as given and redirecting in the data layer.** The data layer has no response to redirect with, and two forms of one slug would be two cache entries. Rejected.

## Consequences

- The Data Cache stores only 200s. A miss by slug is a 200 with an empty list and is cached under its tags; a miss by ID and a resolve miss are a 404 or 401 and are asked again on every render.
- A 200 whose body fails the schema is cached like any other 200, so the render keeps throwing until the interval passes or an event clears its tags. ISR keeps serving the last good page meanwhile.
- A change to the interval or the timeout is a change to one constant and to this record.
