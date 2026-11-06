---
status: accepted
date: 2026-11-03
merges: 0009 (2026-11-06)
---

# One `resource` post type with a `resource_type` taxonomy; `featured` is a term, not meta

The library holds articles, ebooks, webinars, podcasts and case studies, and the front end shows them in one filterable list. We register one post type, `resource`, with the kind in a taxonomy, `resource_type`, alongside `resource_topic`; and we model "featured" as a term, `featured`, in a code-managed hierarchical taxonomy, `resource_flag`, rather than as boolean meta.

**One post type**, because of the read side. Core REST has no cross-type collection that returns full objects and filters by taxonomy: `/wp/v2/articles` and `/wp/v2/webinars` are separate collections with separate pagination, and `/wp/v2/search` filters only by text and returns stubs. A combined listing would mean merging several paginated collections on the client or writing a custom collection route that re-implements what `WP_REST_Posts_Controller` already provides. With one post type, "all resources about performance, newest first, page two" is one core request.

**Type is a fixed vocabulary editors manage; topics are open.** `resource_type` is hierarchical with `manage_terms`, `edit_terms` and `delete_terms` set to `manage_categories` and `assign_terms` to `edit_posts`. `resource_topic` is flat and open like tags, because topics grow with the content.

**Featured is a term**, because filtering by a meta value is an unindexed query against `postmeta.meta_value` that the coding standards flag as slow, and the gate fails on warnings, while term relationships are indexed and the core collection already filters on any `show_in_rest` taxonomy. It also makes featured the same mechanism as topic and type on both sides. A second flag later costs a term, not a field.

**Hierarchical is the capability boundary, not a UI choice.** Core's terms controller checks `edit_terms` before creating a term in a hierarchical taxonomy but only `assign_terms` in a flat one, so a flat `resource_flag` would let every author create flags over REST whatever `edit_terms` said. The same boundary keeps `resource_type` a fixed list. Changing `hierarchical` on either taxonomy is a security change; `ContentModelTest` asserts the REST outcome per role.

## Considered options

- **A post type per kind.** The right move the day the kinds stop sharing a shape (a webinar's recording URL, a podcast's duration). None of that exists; every kind is a title, a body, a summary, an optional link and topics. Rejected for now; the recorded next step if types diverge is to add a post type for the kind that grew fields and keep `resource` for the rest.
- **Kind as meta.** Rejected for the same reason featured is a term: an unindexed filter.
- **Boolean meta with a meta query** for featured. Rejected: the slow-query sniff fails the gate, and the sniff is right about the index.
- **Boolean meta mirrored to a hidden term on save.** Rejected: two sources of truth and a sync hook for every write path.

## Consequences

- A resource is a landing page the site owns; `source_url` is an optional external destination, and the WordPress post stays the canonical record. If a kind ever needs hosted files, the tool is an attachment ID in meta, not a custom table.
- The front end receives `resource_flag: [<id>]` rather than `featured: true` and resolves the term like a topic or type.
- Editors see a Flags panel with one checkbox and no "Add New Flag" button; term management lives in code review.
- WPGraphQL queries across content types natively, so the per-kind model costs much less on the read side there. The stretch goal that adds WPGraphQL should revisit this record.
