---
status: accepted
date: 2026-11-04
---

# Revalidation results are stored in meta and shown where the editor already is

The send runs in cron after the save has returned ([ADR 0012](0012-revalidation-is-sent-from-wp-cron.md)), so the editor cannot learn the result from the save response. The result is stored in post meta `_rh_last_revalidation`: a status that moves from `pending` to `sent` or `failed`, the HTTP code, the event, the time, and the response body cut to about 1 KB. It is exposed as a read-only field registered with `register_rest_field()` in the `edit` context only, so it never appears in the public responses the front end reads.

A batch ([ADR 0014](0014-one-php-request-is-one-batch.md)) gets one response, and that result is written to every resource in the batch, each copy noting that it was sent with N other changes. A bulk edit of twenty resources therefore leaves twenty results, and whichever resource an editor opens shows the outcome of the request that carried it, rather than only the first or last resource holding it.

In the block editor, after a save that is not an autosave completes, a small script polls `?context=edit&_fields=…` about once a second for up to about ten seconds, then dispatches the outcome to `core/notices`. When the editor loads a resource whose last result was a failure, it shows that failure. The notice text maps each outcome to plain words: 200, 400, 401, 500, timeout, any other code, and not configured.

## Bulk actions, trash and Quick Edit

Those paths never open the block editor, so a "Revalidation" column on the Resources list screen (`manage_resource_posts_columns` and `manage_resource_posts_custom_column`, reading the same meta) shows their results. It is hidden by default through `default_hidden_columns` for the `edit-resource` screen, because most people will not care and the table stays clean; anyone who does turns it on in Screen Options.

## Consequences

- Accepted trade-off: a failed trash or Quick Edit stays invisible until someone turns the column on.
- A batch's per-resource copies cost one meta write per resource in the batch, at most 25 per request.
- A force delete has no post left to hold meta, and a deleted term has no term meta, so those results are recorded only by the PostHog event ([ADR 0032](0032-revalidation-results-logged-to-posthog.md)), when PostHog is configured. Otherwise they are only printed, when the send ran under WP-CLI ([ADR 0012](0012-revalidation-is-sent-from-wp-cron.md)), and not recorded at all from the admin. There is no `error_log()` call: it is an error under the VIP ruleset ([ADR 0006](0006-vip-minimum-ruleset-in-the-gate.md)).
- Term events record their result in term meta and show it on the term edit screen ([ADR 0017](0017-term-events.md)).
- The editor retries a failure by saving again ([ADR 0013](0013-three-second-timeout-and-no-retries.md)).
