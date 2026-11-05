---
status: accepted
date: 2026-11-04
---

# The revalidation request times out at 3 seconds and is never retried

[ADR 0006](0006-vip-minimum-ruleset-in-the-gate.md) left this open: CLAUDE.md asked for a 5-second timeout and `WordPressVIPMinimum.Performance.RemoteRequestTimeout` flags anything above 3. We set the timeout to 3 seconds, so the sniff passes with no ignore. A failed or timed-out send is recorded and shown to the editor, and nothing retries it; the editor saves again to retry.

The send runs in cron ([ADR 0012](0012-revalidation-is-sent-from-wp-cron.md)), so the timeout no longer protects the editor; it bounds how long a cron request holds a PHP worker. Three seconds is ample for an endpoint that only invalidates cache tags and paths.

## Considered options

- **5 seconds with a scoped `phpcs:ignore`.** Rejected: nothing needs the extra time, and the sniff is right that a short timeout is the habit to keep.
- **Automatic retries with backoff.** Rejected: a retry queue needs its own storage, scheduling and failure display, and the person best placed to decide whether a failure matters is the editor who just saw it.

## Consequences

- If the front end ever needs slow work on revalidation, it answers first and does the work after. The plugin's timeout is not raised to accommodate it.
- A timeout is its own outcome in the editor notice, distinct from a 500.
- Amended 2026-11-05: the response is bounded as well as the wait, with `limit_response_size` at 64 KB for the front end (enough to parse a full 200's `revalidated` list for 25 events; only about 1 KB is stored) and 1 KB for PostHog, whose answer is ignored, so a misconfigured URL cannot make a cron request download an unbounded body.
- A change the editor does not retry stays stale on the front end until the ISR safety net on that side refreshes it.
