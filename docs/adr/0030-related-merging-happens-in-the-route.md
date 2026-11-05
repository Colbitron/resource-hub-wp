---
status: accepted
date: 2026-11-04
---

# Related items are merged in the custom route, not on the front end

Related resources combine two sources: the editor's picks and the newest resources in the same topics ([ADR 0020](0020-related-is-picks-then-newest-in-topic.md)). Core REST could serve both halves without a custom route: expose `related_picks` in the resource's `meta`, and let the front end fetch the picks and a topic query and merge them. We merge them in WordPress instead. The front end calls `GET /resource-hub/v1/related/{id}` once and gets the final, ordered list of IDs ([ADR 0021](0021-related-route-returns-ids-only.md)).

The merging rules are where the bugs would be: picks come first, picks that are no longer published are skipped, an item that is both a pick and in the topic fill appears once, as a pick, and the list stops at `count`. In the route they live in one place, in PHP, covered by PHPUnit. The picks list itself never has to be public, because the only reader that needs it is the route. And the merged answer is cached in Redis through the object cache ([ADR 0022](0022-related-results-in-a-salted-object-cache.md)), so the work is done once per change, not once per front-end render.

## Considered options

- **Expose `related_picks` in REST meta and merge two core queries on the front end.** No custom route to write. Rejected: the merging rules would live in TypeScript in the front end, outside the plugin's PHPUnit; the picks list would be public data on every resource; and every render that misses the front end's cache would pay for two queries and the merge instead of one cached answer.

## Consequences

- The front end does not read `related_picks`, so the contract's content read does not list it. It stays registered with `show_in_rest` because the editor's picker reads and writes it over REST. Its REST schema puts it in the `edit` context only, so it appears in `context=edit` responses, which require permission to edit the resource, and never in the anonymous reads the front end makes.
- The route is the only place that knows the merging rules, so a change to them is a PHP change with a PHPUnit test, and the front end's code does not move.
- The route's response is `related-response.schema.json` in `packages/ui` ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)).
