---
status: accepted
date: 2026-11-04
---

# Filters and pagination are path segments, not search params

The library filters by topic and by type and paginates. The obvious App Router shape is `/resources?topic=…&type=…&page=…`. Reading `searchParams` makes a page dynamic: a function runs on every request and nothing is prerendered or served from the full-route cache, which defeats ISR and on-demand revalidation. We put every filter and the page number in the path instead: `/resources/[type]/`, `/resources/topic/[topic]/`, `/resources/[type]/topic/[topic]/`, and `…/page/[n]/` on every listing. Path segments can be prerendered and revalidated by tag like any other page.

Filtering is one topic and one type at a time. That keeps the set of listings finite and small: five types plus "any" by five topics plus "any" is 36 listings, times their pages. Topics are managed by editors, so the count grows with them.

## Considered options

- **Search params.** Rejected for the reason above.
- **Several topics or types at once.** Rejected: the combinations multiply past what can sensibly be prerendered.

## Consequences

- `topic` and `page` are reserved and can never be a type slug, because `/resources/topic/…` and `/resources/[type]/page/[n]/` would collide with a type of that name. The WordPress side and the shared schemas enforce it.
- Every path has a trailing slash (`trailingSlash: true`), matching the CMS's permalinks ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)). Amended 2026-11-05: the revalidate route follows the rule too, as `/api/revalidate/`, because `trailingSlash: true` answers the slashless form with a 308, which the plugin's sender never follows.
- The filter controls navigate between these paths rather than writing a query string.
- Type hubs carry a `type:{slug}` tag and topic listings a `topic:{slug}` tag, so a term event from the CMS can invalidate them.
