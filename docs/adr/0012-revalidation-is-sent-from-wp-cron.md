---
status: accepted
date: 2026-11-04
---

# The revalidation request is sent from a WP-Cron single event, with the payload built at schedule time

The editor must never wait on the front end, and the plugin must still record the front end's answer. We schedule a WP-Cron single event (`wp_schedule_single_event( time(), … )`) and call `spawn_cron()` at once, so the send runs in a separate PHP request moments after the save returns. The full payload is built when the event is scheduled and passed as the event's arguments, because by the time cron runs the post may no longer describe what readers saw: trashing renames the slug to `…__trashed`, and a force delete removes the post entirely.

Under WP-CLI the batch is instead sent synchronously at `shutdown`, and the result is printed. A cron run would never reach the terminal, and there is no editor to block.

## Considered options

- **Send during the save.** Rejected: a slow or down front end blocks the editor's save for the length of the timeout.
- **`wp_remote_post()` with `blocking => false`.** Returns at once, but rejected because a non-blocking request never sees the response, so there is nothing to record or show the editor.
- **`fastcgi_finish_request()` at `shutdown`.** Flushes the response to the browser and keeps PHP running. Rejected: it exists only under PHP-FPM, and wp-env runs mod_php, so the local and CI path would differ from the host's.

## Consequences

- The cron callback is a pure sender: it posts the arguments it was given and records the result ([ADR 0018](0018-revalidation-results-shown-in-the-editor.md)). It never reads the post again.
- Events are queued during the request and, at `shutdown`, scheduled as one cron event per batch of at most 25 ([ADR 0014](0014-one-php-request-is-one-batch.md)), or sent at once under WP-CLI. Amended 2026-11-04, when the hook was built: each batch carries a fresh batch ID in its cron arguments, because core drops a second single event with the same hook and arguments within ten minutes of the first, and two identical batches (the status page's test button twice, say) must both run; the ID also ties each object's stored result to the PostHog event. When the front-end URL or the secret is unset, the batch is not scheduled at all: the "not configured" result is recorded at `shutdown` with no cron event and no loopback request, so an unconfigured site pays nothing per save.
- The editor learns the result asynchronously, which is why the block editor polls for it after a save.
- The send depends on WP-Cron being able to spawn on the host; it is a loopback request, not a system cron. Checked on the host on 2026-11-04: `DISABLE_WP_CRON` is unset and there is no system crontab, so `spawn_cron()` sends at once. If WP-Cron is ever disabled in favour of a system cron, sending waits for that cron's interval, and the editor's post-save poll ([ADR 0018](0018-revalidation-results-shown-in-the-editor.md)) times out before the result arrives.
