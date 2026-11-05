---
status: accepted
date: 2026-11-04
---

# The front end's data cache is the only HTTP cache for REST responses

Between the front end and WordPress sit Cloudflare and Cloudways' Varnish. A cached REST response anywhere in that chain would survive a revalidation: Next.js would refetch and receive the stale copy. Next.js's data cache is the only HTTP cache that the revalidation request can clear, so it is the only one we allow. A `rest_post_dispatch` filter adds `Cache-Control: no-cache, must-revalidate, max-age=0` to anonymous responses from `/wp/v2/resources`, the three taxonomy endpoints, and `/resource-hub/v1/`.

Observed on the host, 2026-11-04: Varnish passed `/wp-json` (no `Age` or `X-Cache` header, while the homepage was a HIT), and Cloudflare in front reported `cf-cache-status: DYNAMIC`. On 2026-11-04 the host was configured that way; the header makes that behaviour explicit and portable rather than dependent on the host's configuration.

## Considered options

- **A Varnish exclusion rule.** Not added: Varnish passed `/wp-json` when checked, and a host-panel rule would live outside the repository.

## Consequences

- Logged-in responses are left alone; core sends its own no-cache headers for them (`rest_send_nocache_headers`).
- Decided 2026-11-05: every anonymous response on a covered route gets the header, with no exemption for `edit` context. Exempting on a request parameter would leave a future anonymous 200 uncovered, and the logged-in check already leaves core's own headers alone. Anonymous `edit`-context requests (a 401), writes and `OPTIONS` responses get the header too; that is harmless, since none of them is a copy worth caching.
- Decided 2026-11-05: a `Cache-Control` already on the response that contains `no-store` or `private` is kept, because it is stricter than ours; any other value is replaced.
- Decided 2026-11-05: error responses on the covered routes get the header too. A 404 is as cacheable as a 200 (Varnish's built-in rules store it), and publishing is what turns one into the other, so a cached 404 from `/wp/v2/resources/{id}` or the resolve route would outlive the revalidation meant to replace it. A request that matches no route is not covered.
- Decided 2026-11-05: the filter matches the route pattern WordPress dispatched to, against bases read from the registered post type and taxonomies (`rest_get_route_for_post_type_items()`, `rest_get_route_for_taxonomy_items()`), so a changed `rest_base` moves the header with it and the URL's case or trailing slash does not matter.
- Unverified: that an upstream `no-cache` does not stop Next.js's own fetch cache from storing the response. The front end's data layer has to check it; if the header does stop it, the header changes, not the front end's caching.
- Amended 2026-11-05: verified, the header does not stop it. The front end's e2e spec (`apps/web/e2e/revalidate.spec.ts`, "freshness end to end") loads a fixture page whose one `fetch` carries `cache: "force-cache"` and `next: { tags, revalidate: 3600 }` against the mock CMS, which answers with exactly this header, `Cache-Control: no-cache, must-revalidate, max-age=0`; two loads cost one upstream request, the page stays stale after the mock's data changes, and only a revalidation event ([ADR 0048](0048-the-revalidate-route.md)) makes the next load fetch again. Next.js 16.4.5's Data Cache stores a `fetch` response by the options the caller gives, not by the response's cache headers, so the header keeps Varnish and Cloudflare out without affecting the one cache the revalidate route clears. The header stays as it is.
- Cache invalidation is in one place: the front end's revalidate route.
