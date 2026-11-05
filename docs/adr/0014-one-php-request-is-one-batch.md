---
status: accepted
date: 2026-11-04
---

# One PHP request sends one batch of events

A bulk edit or bulk trash of twenty resources in the admin would, with one request per post, fire twenty requests at the front end within a second. The revalidation body is instead a versioned batch, `{ "version": 1, "events": [ … ] }`. There is no batch detection: every event raised during a PHP request is queued, and at `shutdown` the queue is scheduled as one cron event ([ADR 0012](0012-revalidation-is-sent-from-wp-cron.md)). Bulk edit and bulk trash are each a single PHP request, so each becomes one batch, and a single save is simply a batch of one.

Within a batch, events are deduplicated per resource ID for resource events and per (taxonomy, term ID) for term events, so a post and a term that share a numeric ID never merge. Each group becomes one event carrying the earliest `previous` and the latest current state, so a post saved twice in one request is reported once with the full change. Resource events and term events ([ADR 0017](0017-term-events.md)) share the same `events` array. A batch over 25 events is split into several requests of at most 25.

Amended 2026-11-05, after review of the hook: when a group ends in a removal (`unpublish`, `trash` or `delete`, or a term `delete`) and an earlier event in it was an `update`, the merged event's top-level state is the state from before the request began, not the renamed state the update left, because only the earlier state can be in the front end's cache; `previous` stays `null` as on every removal. An update that renames a resource followed by a trash in one request therefore sends `trash` under the original slug, and a term renamed and then deleted sends `delete` with its original slug and name.

## Considered options

- **One request per event.** Rejected: bulk actions turn into bursts of near-identical requests, each revalidating the same listings.
- **Detecting bulk actions and batching only those.** Rejected: every admin screen and CLI path would need its own detection, while "one request, one batch" needs none.

## Consequences

- `version` is fixed at 1 by the schema ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)); a breaking change to the event shapes bumps it.
- The 25-event cap is in the schema, so the front end can reject an oversized body with a 400.
- The front end revalidates the union of the paths and tags across the whole batch, so overlapping events cost nothing extra.
