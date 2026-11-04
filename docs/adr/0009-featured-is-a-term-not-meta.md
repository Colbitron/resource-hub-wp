---
status: accepted
date: 2026-11-03
---

# `featured` is a term in a code-managed `resource_flag` taxonomy, not boolean meta

Some resources are featured: shown first, eligible for a highlighted section on the front end. The obvious model is a boolean meta field, and the first draft of CLAUDE.md said exactly that. We model it instead as a term, `featured`, in a hierarchical taxonomy, `resource_flag`, whose terms are created by the plugin on `init` and cannot be managed by editors.

Two facts decide it. First, the front end needs to filter by it, and filtering by a meta value is a query against `postmeta.meta_value`, which has no index; the WordPress Coding Standards flag it as a slow query (`WordPress.DB.SlowDBQuery.slow_db_query_meta_query`) and the gate fails on warnings ([ADR 0006](0006-vip-minimum-ruleset-in-the-gate.md)). Term relationships are indexed for exactly this use, and the core REST collection already filters on any `show_in_rest` taxonomy. Second, it makes featured the same mechanism as topic and type: `?resource_flag=<id>` next to `?resource_topic=<id>` and `?resource_type=<id>`, one code path on both sides. The taxonomy's capabilities (`manage_terms`, `edit_terms`, `delete_terms` set to `do_not_allow`; `assign_terms` to `edit_posts`) keep the set of flags in code, and `hierarchical` is what makes them hold. It is the capability boundary, not only a UI choice: core's terms controller checks `edit_terms` before creating a term in a hierarchical taxonomy but only `assign_terms` in a flat one, so a flat `resource_flag` would let every author and editor create flags over REST whatever `edit_terms` said. Being hierarchical also makes the editor render a checkbox list rather than a free-text tag box. The same boundary keeps `resource_type` a fixed vocabulary that editors manage ([ADR 0007](0007-one-post-type-with-a-type-taxonomy.md)).

## Considered options

- **Boolean meta with a meta query.** The simplest to read, and what the front end would naturally expect (`featured: true`). Rejected: the slow-query sniff fails the gate, and the sniff is right about the index.
- **Boolean meta mirrored to a hidden term on save.** Keeps the boolean in the API and the indexed query in the database. Rejected: two sources of truth and a sync hook that must handle every write path (REST, editor, WP-CLI, imports) without drift.

## Consequences

- A boolean modelled as a term reads oddly outside WordPress. The front end receives `resource_flag: [<id>]` rather than `featured: true` and resolves the term, like it does for topics and types; the matching change on that side is made in the same sitting.
- A second flag later costs a term, not a field: add it next to `featured` in `Taxonomies::register()`, and it is assignable and filterable at once.
- The `featured` term is ensured on every `init` rather than on activation, because the PHPUnit bootstrap and wp-env's tests site reinstall WordPress without firing activation hooks. The lookup is a term query: answered from memory with a persistent object cache, one database query per request without one. If two requests race to create it, the loser returns the winner's term ID.
- Editors see a "Flags" panel with a single checkbox and no "Add New Flag" button. Term management lives in code review. The taxonomy has its own full set of labels, so no screen falls back to core's "Category" wording.
- Changing `hierarchical` on `resource_flag` or `resource_type` is a security change, not a cosmetic one. PHPUnit asserts the REST outcome for each role: an editor creating a flag gets 403, an author creating a type gets 403 while an editor or administrator gets 201, and an author creating a topic gets 201.
