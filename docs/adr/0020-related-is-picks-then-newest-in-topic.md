---
status: accepted
date: 2026-11-04
---

# Related resources are editor picks first, then the newest resources in the same topics

`GET /resource-hub/v1/related/{id}` answers "what should a reader see next?". One design ranks by shared-topic overlap: one `WP_Query` over the source's topics, newest first, capped at 50 with `no_found_rows`, overlap counted in PHP, sorted by overlap then date. We chose instead to let editors pick, and to fill the remaining slots with the most recent published resources from the source's topics, newest first only, with no overlap ranking. A hand-picked list says what an editor means; the newest-in-topic fill keeps every resource covered without anyone curating it.

Picks are stored in `related_picks` post meta, an ordered array of post IDs, sanitized to positive integers, deduplicated, with the resource itself dropped and the list capped at 10; the auth callback is `MetaRules::can_edit_post`. Picks are one-way: picking B on A says nothing about A on B. A pick that is no longer published is skipped at read time but kept in the meta. When there are more picks than `count`, the first `count` win.

The route's rules: a public permission callback, a 404 for an ID that is not a published resource, `count` an integer from 1 to 10 defaulting to 3, published resources only and never the source itself. A source with no topics returns its published picks alone, with no fill, because the picks are still what the editor meant; a source with neither returns an empty list. Where these rules run, on the server rather than in the front end, is [ADR 0030](0030-related-merging-happens-in-the-route.md).

## Considered options

- **Overlap ranking.** Described above; superseded by picks, and the fill does not need it.
- **Any overlap, newest first, with no picks.** Simplest, but no editorial control and no ranking.
- **Raw SQL with `GROUP BY` to rank in the database.** Rejected: the VIP sniffs flag direct queries and CLAUDE.md rules raw SQL out.

## Consequences

- The editor UI sits in the existing Resource details sidebar panel: a `ComboboxControl` search and an ordered list with up, down and remove buttons, no drag and drop. Two `SelectControl`s (default "Any") filter the search by type and topic term ID; the search is a debounced `getEntityRecords` call (`per_page` 20) over published resources only, leaving out the current resource and anything already picked.
- The scale path, if the topic query ever becomes slow, is search-backed related posts (ElasticPress) or a precomputed list in post meta, never raw SQL.
- The response shape is [ADR 0021](0021-related-route-returns-ids-only.md) and its cache is [ADR 0022](0022-related-results-in-a-salted-object-cache.md).
