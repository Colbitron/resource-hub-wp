---
status: accepted
date: 2026-11-04
---

# The related route returns IDs and a reason, not resources

The front end already renders resource cards from the core collection, with its own parser and type. The related route returns `{ "items": [ { "id": 12, "source": "pick" | "topic" } ] }` and nothing else: no titles, no permalinks, no embedded terms. The front end then fetches `GET /wp-json/wp/v2/resources?include={ids}&orderby=include&_embed` and renders the result with the same listing card it uses everywhere, so one code path renders a resource and the related route never has to keep a second copy of the resource shape in step with core's.

`source` says why each item is there: `pick` for an editor's choice, `topic` for the newest-in-topic fill ([ADR 0020](0020-related-is-picks-then-newest-in-topic.md)).

## Consequences

- Related items cost the front end two requests instead of one. Both are cached by the front end's data cache ([ADR 0023](0023-next-data-cache-is-the-only-http-cache.md)), and the second is a core request it already knows how to parse.
- The response is small and the same for every reader, which keeps the object-cache entry small ([ADR 0022](0022-related-results-in-a-salted-object-cache.md)).
- No permalink in the response means no URL to rewrite from the CMS domain to the front end's.
- The shape is `related-response.schema.json` in `packages/ui` ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)).
