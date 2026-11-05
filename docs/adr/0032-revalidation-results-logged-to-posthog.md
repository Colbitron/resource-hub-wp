---
status: accepted
date: 2026-11-04
---

# Every revalidation result is also sent to PostHog as a server-side event

Results are stored where an editor will see them: the resource's or term's `_rh_last_revalidation` meta ([ADR 0018](0018-revalidation-results-shown-in-the-editor.md), [ADR 0017](0017-term-events.md)). Two results have nowhere to go: a force delete and a term delete remove the object that would hold them. And meta keeps only the last result per object, so there is no history to look back on. We send every revalidation result, one per batch request to the front end, as a server-side PostHog event as well. The cron job that made the request sends it with `wp_remote_post()` straight after recording the result, with a 3-second timeout ([ADR 0013](0013-three-second-timeout-and-no-retries.md)); a failure is ignored and never retried, because logging must not become a second thing that can fail a revalidation.

PostHog is configured by two optional constants, `RESOURCE_HUB_POSTHOG_KEY` and `RESOURCE_HUB_POSTHOG_HOST`, `define()`d in `wp-config.php` like the other two and never committed. When either is unset the event is skipped, so wp-env and CI send nothing unless someone sets them. When the send runs under WP-CLI, synchronously ([ADR 0012](0012-revalidation-is-sent-from-wp-cron.md)), the result is also printed. Front-end analytics stay on the front end; this event is the plugin's own record of what it sent and what came back.

## Considered options

- **`error_log()`.** Rejected: it is an error under the VIP ruleset ([ADR 0006](0006-vip-minimum-ruleset-in-the-gate.md)), and a PHP log on a managed host is not somewhere anyone looks.
- **A log in an option or a custom table.** Rejected: storage that grows without bound, and a table needs raw SQL, which CLAUDE.md rules out.
- **A log file.** Rejected: no filesystem writes at runtime.
- **Logging on the front end only.** Rejected: the front end cannot record a request that never reached it, which is what a timeout or a missing configuration looks like.

Amended 2026-11-05, after reading PostHog's [capture API](https://posthog.com/docs/api/capture) (section "Anonymous event capture") and [anonymous vs identified events](https://posthog.com/docs/data/anonymous-vs-identified-events) docs that day: the event is sent as anonymous, with `$process_person_profile` set to `false`, so PostHog creates no person profile for it. The "person" would be the server, which is not someone to profile, and anonymous events are billed at PostHog's cheaper anonymous rate past the free tier ("up to 4x cheaper", per those docs). It is posted to the documented single-event endpoint, `{host}/i/v0/e/`, rather than `{host}/capture/`, which the docs do not mention. An event whose `distinct_id` belongs to a person still counts as identified, so the `distinct_id` is namespaced, `resource-hub-cms:{CMS host}` (`resource-hub-cms:unknown` when `home_url()` has no host), and can never match a person's; a `site` property holds the bare CMS host so events can still be grouped by site. Sampling and rollups for high volume are tracked in [issue #17](https://github.com/Colbitron/resource-hub-wp/issues/17).

## Consequences

- A cron run makes up to two outbound requests per batch, so it holds a PHP worker for at most about six seconds.
- The PostHog request is never checked, so a wrong key fails silently; the status page ([ADR 0019](0019-settings-page-is-a-status-page.md)) can show whether the constants are set, not whether events arrive.
- The event is named `revalidation_result` and sent anonymously; its `distinct_id` is `resource-hub-cms:{CMS host}`, its `site` property is the bare CMS host, and its properties include the status, the number of events and their types, and the duration. It also has to name the events it covered, at least their type, ID and slug, or a force delete's or a term delete's outcome could not be found.
- New host setup: a PostHog project key and host `define()`d in the host's `wp-config.php`.
