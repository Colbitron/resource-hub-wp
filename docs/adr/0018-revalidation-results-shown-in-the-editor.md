---
status: accepted
date: 2026-11-04
---

# Revalidation results are stored in meta and shown where the editor already is

The send runs in cron after the save has returned ([ADR 0012](0012-revalidation-is-sent-from-wp-cron.md)), so the editor cannot learn the result from the save response. The result is stored in post meta `_rh_last_revalidation`: a status that moves from `pending` to `sent` or `failed`, the HTTP code, the event, the time, and the response body cut to about 1 KB. It is exposed as a read-only field registered with `register_rest_field()` in the `edit` context only, so it never appears in the public responses the front end reads.

A batch ([ADR 0014](0014-one-php-request-is-one-batch.md)) gets one response, and that result is written to every resource in the batch, each copy noting that it was sent with N other changes. A bulk edit of twenty resources therefore leaves twenty results, and whichever resource an editor opens shows the outcome of the request that carried it, rather than only the first or last resource holding it.

In the block editor, after a save that is not an autosave completes, a small script polls `?context=edit&_fields=…` about once a second for up to about ten seconds, then dispatches the outcome to `core/notices`. When the editor loads a resource whose last result was a failure, it shows that failure. The notice text maps each outcome to plain words: 200, 400, 401, 500, timeout, any other code, and not configured.

Amended 2026-11-05, to match what the hook stores: each record holds `status` (`pending`, `sent` or `failed`), `outcome`, `code`, `event`, `time`, `batch_id` (shared by every object in the batch and by the PostHog event), `others` (how many other changes travelled with it), `body` (valid UTF-8, cut to about 1 KB), `error` (a transport error or a plain message, else `null`) and `duration_ms`. The outcomes are `pending` while scheduled, then `ok`, `bad_body` (a 200 whose body is not a JSON object with a `revalidated` array, which means the URL reaches something other than the revalidate route), `bad_request`, `unauthorized`, `server_error`, `unexpected_code`, `timeout`, `transport_error`, `not_configured`, `no_single_type` (held back because the resource does not have exactly one type) and `encode_error` (the payload could not be encoded as JSON, so nothing was sent). Only `ok` is `sent`. Should core refuse to store a record, it is stored again with an empty body and an `error` saying so, so a result never stays `pending` for that reason.

Amended 2026-11-05, with the choices the editor-facing build made: the comparison baseline for "this save's result" is the record the save response itself carried, which is the record from before the save because the hook writes at `shutdown`, after the response; a polled record counts as new once its `batch_id` or `time` differs, and polling runs only after a save where the status before or after it is `publish`, so a draft save shows nothing. A success is a snackbar and anything else a dismissible notice; on load, a last result that is not `sent` (a failure or a pending) is shown. A 400 or a 500 quotes the front end's `error` string from the stored JSON body, never the raw body, and the same wording is in PHP for the other screens. A `pending` older than five minutes is shown everywhere as "No answer recorded: the send may not have run", display only (the record is never rewritten): a scheduled batch is spawned at once and WP-Cron's lock lasts 60 seconds, so five minutes of `pending` means the cron request never ran. The term notice is printed through `{$taxonomy}_term_edit_form_top` as an inline notice, so nothing is read from the request. The list column shows a label and the relative time, never the body.

## Bulk actions, trash and Quick Edit

Those paths never open the block editor, so a "Revalidation" column on the Resources list screen (`manage_resource_posts_columns` and `manage_resource_posts_custom_column`, reading the same meta) shows their results. It is hidden by default through `default_hidden_columns` for the `edit-resource` screen, because most people will not care and the table stays clean; anyone who does turns it on in Screen Options.

## Consequences

- Accepted trade-off: a failed trash or Quick Edit stays invisible until someone turns the column on.
- A batch's per-resource copies cost one meta write per resource in the batch, at most 25 per request.
- A force delete has no post left to hold meta, and a deleted term has no term meta, so those results are recorded only by the PostHog event ([ADR 0032](0032-revalidation-results-logged-to-posthog.md)), when PostHog is configured. Otherwise they are only printed, when the send ran under WP-CLI ([ADR 0012](0012-revalidation-is-sent-from-wp-cron.md)), and not recorded at all from the admin. There is no `error_log()` call: it is an error under the VIP ruleset ([ADR 0006](0006-vip-minimum-ruleset-in-the-gate.md)).
- Term events record their result in term meta and show it on the term edit screen ([ADR 0017](0017-term-events.md)).
- The editor retries a failure by saving again ([ADR 0013](0013-three-second-timeout-and-no-retries.md)).
