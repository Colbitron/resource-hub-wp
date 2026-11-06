---
status: accepted
date: 2026-11-04
merges: 0012 (2026-11-06)
---

# Revalidation fires from `wp_after_insert_post` and `before_delete_post`, and is sent from WP-Cron

The front end has to hear about every change to a public resource, and the payload names the resource's slug, type and topics, so the hook must run after WordPress has saved the terms and meta as well as the post row. And the editor must never wait on the front end, while the plugin must still record the front end's answer.

**The trigger** is `wp_after_insert_post`, filtered to the `resource` post type, plus `before_delete_post` for published resources. `wp_after_insert_post` fires after terms and meta are saved, from every write path that matters: the REST controller (the block editor), `wp_insert_post()`, `wp_publish_post()` (scheduled posts going live), and the trash, which is a status update. The event is derived by comparing the `$post_before` status with the new one. A force delete never passes through an insert, so `before_delete_post` covers it while the post and its terms still exist.

**The send** is a WP-Cron single event scheduled at `shutdown` with `spawn_cron()` called at once, so it runs in a separate PHP request moments after the save returns. The full payload is built when the event is scheduled and passed as its arguments, because by the time cron runs a trashed post has been renamed `…__trashed` and a deleted one is gone. Under WP-CLI the batch is sent synchronously and the result printed.

## Considered options

- **`post_updated`.** Rejected: it fires before the REST controller saves terms, sees no meta, and does not fire for new posts.
- **`save_post` / `save_post_resource`.** Rejected for the same ordering reason.
- **`transition_post_status` plus `wp_trash_post`.** Rejected: both fire before terms and meta are written; two hooks would see less than one.
- **Sending during the save.** Rejected: a slow or down front end blocks the editor's save for the length of the timeout.
- **`wp_remote_post()` with `blocking => false`.** Rejected: a non-blocking request never sees the response, so there is nothing to record.
- **`fastcgi_finish_request()` at `shutdown`.** Rejected: it exists only under PHP-FPM, and wp-env runs mod_php, so the local path would differ from the host's.

## Consequences

- One code path decides the event for every save; the five event names and the states they describe are part of the contract.
- The cron callback is a pure sender: it posts the arguments it was given and records the result. The editor learns the result asynchronously, which is why the block editor polls after a save.
- The send depends on WP-Cron being able to spawn on the host. Where it cannot, sends wait and the editor's poll times out. The behaviour, the batching, what is held back and where results appear are in [`docs/architecture/revalidation.md`](../architecture/revalidation.md).
