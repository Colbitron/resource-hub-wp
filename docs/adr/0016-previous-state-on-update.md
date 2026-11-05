---
status: accepted
date: 2026-11-04
---

# An `update` event carries the resource's previous slug, type and topics

When an update removes a topic, renames the slug or changes the type, the front end has to revalidate the listings and the URL the resource just left as well as the ones it now appears in, and the current state alone cannot name them. Every resource event therefore carries `previous: { slug, types, topics }`. It is set only on `update`, with all three fields filled every time whether or not they changed, and is `null` for every other event: `publish` has no earlier public state, and the removal events already describe the last public state at the top level ([ADR 0015](0015-five-resource-events.md)). The front end revalidates the union of the current and previous fields.

`types` stays an array, documented and enforced by the schema as exactly one element ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)), so it has the same shape as `topics`.

Amended 2026-11-05, after review of the hook: a resource saved outside the REST API can have no type or two, and an event whose top-level `types` is not exactly one element is held back and recorded as a failure, since the schema would reject the batch. When only `previous.types` is invalid, as on the save that gives such a resource its one type, the event is still sent as an `update`, with `previous.slug` and `previous.topics` kept and `previous.types` set to the current, valid type: the old slug's URL and the topic listings the resource just left still need revalidating, the front end never had a valid page under the invalid earlier types, so standing the current type in for them costs at most one extra type path, and the payload stays schema-valid. A removal that follows such an update in the same request takes its top-level state from before the request ([ADR 0014](0014-one-php-request-is-one-batch.md)), and so the same invalid `types`; it takes `types` from the removal's own state instead when that is exactly one type, and is held back otherwise. Removal events with an invalid top-level `types` stay held back.

## Consequences

- The front end never has to diff fields to decide what changed; it revalidates both states and lets overlapping tags collapse.
- Deduplication within a batch keeps the earliest `previous` ([ADR 0014](0014-one-php-request-is-one-batch.md)), so two saves in one request still report the state before the first.
- `previous.slug` is what lets the old URL's cached page be revalidated after a rename; resolving the old URL to the new one is [ADR 0029](0029-old-slugs-resolve-through-core.md).
