---
status: accepted
date: 2026-11-04
---

# Revalidation fires from `wp_after_insert_post` and `before_delete_post`

The front end has to hear about every change to a public resource, and the payload it receives names the resource's slug, type and topics, so the hook must run after WordPress has saved the terms and meta as well as the post row. The usual candidates are `transition_post_status` or `save_post_resource` plus `wp_trash_post`. We use `wp_after_insert_post` as the single trigger, filtered to the `resource` post type, plus `before_delete_post` for published resources.

Core's documentation and source settle it. `wp_after_insert_post` fires after terms and meta are saved, and it is called from every write path that matters here: `WP_REST_Posts_Controller` on create and update (the block editor), `wp_insert_post()`, and `wp_publish_post()` (scheduled posts going live). Trashing goes through `wp_update_post()`, so it fires there too, and one hook covers publish, update, unpublish and trash. The event is derived by comparing the `$post_before` status with the new status. A force delete skips the trash and never passes through an insert, so `before_delete_post` covers it while the post and its terms still exist.

## Considered options

- **`post_updated`.** A common choice on traditional sites. Rejected: it fires before the REST controller saves terms, so the payload would carry the old topics; it sees no meta; and it does not fire for new posts.
- **`save_post` / `save_post_resource`.** Rejected for the same ordering reason: on a REST save it fires inside `wp_insert_post()`, before the controller writes terms and meta.
- **`transition_post_status` plus `wp_trash_post`.** Rejected: `transition_post_status` also fires inside `wp_insert_post()` before the REST controller writes terms and meta, and `wp_trash_post` fires before the trash happens; two hooks would see less than `wp_after_insert_post` sees alone.

## Consequences

- One code path decides the event for every save; the five events and the states they describe are [ADR 0015](0015-five-resource-events.md).
- `wp_after_insert_post` fires for every post type, autosaves and revisions included; the handler returns early for anything that is not a `resource` and for saves that never touch public state.
- Amended 2026-11-04, when the hook was built: `$post_before` is the post row, not its terms, so the terms a resource had before a save are snapshotted at `pre_post_update`, which fires inside `wp_insert_post()` before any path writes terms; that snapshot is `previous` on `update` ([ADR 0016](0016-previous-state-on-update.md)) and the last public state on `unpublish` and `trash`. And plain PHP can insert a published post and assign its terms afterwards (`wp_insert_post()` then `wp_set_object_terms()`, as the seeder does), so the hook fires before the terms exist; the top-level state of a `publish` or `update` event is therefore read again from the post at `shutdown`, when the request has finished writing and the batch is built ([ADR 0012](0012-revalidation-is-sent-from-wp-cron.md)). Removal events keep the state captured at the hook.
- The same two hooks bump the related cache's salt ([ADR 0022](0022-related-results-in-a-salted-object-cache.md)), so cache invalidation and revalidation see the same set of changes.
