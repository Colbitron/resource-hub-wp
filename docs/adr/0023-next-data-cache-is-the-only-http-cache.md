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

- Logged-in and `edit`-context responses are left alone; the filter targets the anonymous reads the front end makes.
- Decided 2026-11-05: error responses on the covered routes get the header too. A 404 is as cacheable as a 200 (Varnish's built-in rules store it), and publishing is what turns one into the other, so a cached 404 from `/wp/v2/resources/{id}` or the resolve route would outlive the revalidation meant to replace it. A request that matches no route is not covered.
- Decided 2026-11-05: the filter matches the route pattern WordPress dispatched to, against bases read from the registered post type and taxonomies (`rest_get_route_for_post_type_items()`, `rest_get_route_for_taxonomy_items()`), so a changed `rest_base` moves the header with it and the URL's case or trailing slash does not matter.
- Unverified: that an upstream `no-cache` does not stop Next.js's own fetch cache from storing the response. The front end's data layer has to check it; if the header does stop it, the header changes, not the front end's caching.
- Cache invalidation is in one place: the front end's revalidate route.
