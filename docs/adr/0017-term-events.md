---
status: accepted
date: 2026-11-04
---

# Topic and type changes send term events

Renaming a topic, re-slugging a type or deleting either changes listings and labels on the front end without saving any resource, so resource events alone would leave those pages stale. We add a term event to the same batch ([ADR 0014](0014-one-php-request-is-one-batch.md)): `{ "type": "term", "taxonomy", "event": "create" | "update" | "delete", "id", "slug", "name", "previous": { "slug", "name" } | null }`, for `resource_topic` and `resource_type`. `resource_flag` terms are managed in code ([ADR 0009](0009-featured-is-a-term-not-meta.md)) and send none.

`edit_terms` captures the old slug and name before the change; `created_{taxonomy}`, `edited_{taxonomy}` and `delete_{taxonomy}` for the two taxonomies schedule the same cron send ([ADR 0012](0012-revalidation-is-sent-from-wp-cron.md)), with the same 3-second timeout and no retries ([ADR 0013](0013-three-second-timeout-and-no-retries.md)). `previous` is set only on `update`.

## Consequences

- The result is stored in term meta `_rh_last_revalidation` and shown as an `admin_notices` notice on the term edit screen on its next load. A deleted term has nowhere to store it, so a term `delete` result is recorded only in PostHog ([ADR 0032](0032-revalidation-results-logged-to-posthog.md)).
- A term event also bumps the `resource_hub` cache salt ([ADR 0022](0022-related-results-in-a-salted-object-cache.md)).
- The front end tags type hubs `type:{slug}` so a type event has something to invalidate.
- Old topic URLs return 404 after a re-slug; there is no topic redirect. Resource pages on the front end recover from a type re-slug by themselves, because the type segment of their URL is checked and a mismatch redirects ([ADR 0025](0025-redirects-are-computed-308s-with-no-store.md)).
- Assigning or removing terms on a resource is not a term event; it is an `update` of that resource.
- An edit that changes neither the slug nor the name, such as a description or a parent, sends nothing, because the front end shows neither.
