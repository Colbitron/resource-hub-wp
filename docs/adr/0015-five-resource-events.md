---
status: accepted
date: 2026-11-04
---

# Resource events are `publish`, `update`, `unpublish`, `trash` and `delete`

Three events, `publish`, `update` and `trash`, would leave no way to report a published resource moved back to draft, and no way to report a force delete. We use five: `publish` (the resource became public), `update` (a public resource was saved and stayed public), `unpublish` (a public resource moved to draft, pending, private or scheduled), `trash`, and `delete` (a published resource was permanently deleted). The front end sorts them into two groups: refresh for `publish` and `update`, remove for the other three, where its refetch returns nothing and the page becomes a 404.

The top-level `slug`, `types` and `topics` describe the public state the event concerns: the state after the save for `publish` and `update`, and the last public state, taken from `$post_before`, for the three removals. A trashed resource is therefore reported under the slug readers used, never its `__trashed` form.

## Consequences

- Changes that never touch public state send nothing: editing a draft, or restoring from the trash, which restores to draft.
- `delete` comes from `before_delete_post` for published resources ([ADR 0011](0011-revalidation-fires-on-wp-after-insert-post.md)); a resource that was already trashed was removed from the front end by its `trash` event.
- The front end needs only the two groups, not five code paths, and a new event name would be a schema change ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)).
