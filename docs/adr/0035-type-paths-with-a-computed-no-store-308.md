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
