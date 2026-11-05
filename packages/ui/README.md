# @colbitron/resource-hub-ui

The contract between the Resource Hub WordPress plugin ([`wp-content/plugins/resource-hub-wp/`](../../wp-content/plugins/resource-hub-wp/)) and its Next.js front end ([`apps/web/`](../../apps/web/)), both in this repository, written once as JSON Schema (draft 2020-12) so both sides can check themselves against it ([ADR 0010](../../docs/adr/0010-contract-as-json-schema-in-a-shared-package.md)). PHPUnit in the plugin validates the payloads it builds against these schemas once the revalidation hook exists; the front end derives its Zod types from them. When either side drifts from the schemas, its own test fails.

Every schema and every property carries a `description` that states what the value means, not only what type it is. The schemas are the contract; this file is the summary.

## Schemas

| File | Describes |
|---|---|
| `schemas/revalidate-request.schema.json` | Body of `POST {FRONTEND_URL}/api/revalidate`, WordPress to front end: a batch of resource and term events |
| `schemas/revalidate-response-ok.schema.json` | The `200` reply: the paths the front end revalidated |
| `schemas/revalidate-response-error.schema.json` | The `400`, `401` and `500` replies: `{ "error": "…" }`; `401` is exactly `unauthorized` |
| `schemas/related-response.schema.json` | `GET /wp-json/resource-hub/v1/related/{id}?count=n`: related resource IDs with the reason each was picked |
| `schemas/resolve-response.schema.json` | `GET /wp-json/resource-hub/v1/resolve?slug=…`: an old or current slug to the resource's canonical id, type and slug |
| `schemas/wp-error.schema.json` | The WordPress core REST error shape both custom routes return for `400` and `404` |
| `schemas/common.schema.json` | Shared `$defs` the others reference: `id`, `slug`, `typeSlug`, `topicSlug`, `typeList`, `topicList`, `path` |

The bearer token on the revalidation request is a header and is not part of any schema.

## Semantics the schemas assume

**A revalidation request is a batch.** `{ "version": 1, "events": [ … ] }`, with 1 to 25 events. One WordPress PHP request produces one batch, so a bulk edit or a bulk trash in the admin is one request to the front end, not one per post. Events within a batch are deduplicated per resource ID for resource events and per (taxonomy, term ID) for term events, so a post and a term that share a numeric ID never merge; each group becomes one event carrying the earliest `previous` and the latest current state. A group that ends in `unpublish`, `trash` or `delete` after an `update` in the same request carries, at the top level, the state from before that update (for a term, its slug and name from before a rename), because that is the state the front end can have cached; `previous` stays `null`. A batch that would exceed 25 events is split into several requests.

**Resource events describe the public state the event concerns.** The top-level `slug`, `types` and `topics` are the state after the save for `publish` and `update`, and the last public state before removal for `unpublish`, `trash` and `delete` (or, after an `update` in the same request, the state before the request). A trashed post's slug is therefore the slug readers used, never the `__trashed` form WordPress renames it to.

**`previous` is non-null only and always on `update`.** It holds the slug, type and topics (for a term event, the slug and name) from before the save, so the front end can also revalidate the listings and URL the item just left. For every other event it is `null`: `publish` and `create` have no earlier public state, and the removal events already describe the last public state in the top-level fields.

**The front end groups events.** `publish` and `update` mean refresh; `unpublish`, `trash` and `delete` mean remove, where its refetch of the resource returns nothing and the page becomes a 404. For every event it revalidates the union of the paths and cache tags implied by the current and the `previous` state. The tags are `resources`, `resource:{slug}`, `topic:{slug}` and `type:{slug}`.

**A resource has exactly one type.** `types` is a one-element array because the type is a URL segment and a resource has one canonical URL. The array form keeps the field the same shape as `topics`.

**Reserved type slugs.** A `resource_type` slug is never `topic` or `page`, because the front end's routes `/resources/topic/[topic]/` and `/resources/[type]/page/[n]/` would collide with a type of that name. The schemas enforce it wherever a type slug appears: a resource event's `types` and `previous.types`, a term event's `slug` and `previous.slug` when its taxonomy is `resource_type`, and the resolve response's `type`.

**`rest_url` is fetched, so the front end checks its host.** The schema pins its scheme to `http` or `https`, which rejects `javascript:`, `mailto:` and the like, but it cannot know the WordPress origin. Before fetching `rest_url` the front end must check that its host matches the WordPress origin it is configured with, and refuse it otherwise. That check is the guard against server-side request forgery, and it lives on the front end.

**Related items are IDs only.** The related route returns `{ "id", "source" }` pairs, at most 10, and the front end fetches the full objects with `GET /wp-json/wp/v2/resources?include={ids}&orderby=include&_embed`, so one code path renders a resource everywhere.

## Public URL shape (informational)

Both sides mirror this; it is not schema-validated. Every path has a trailing slash, and every listing paginates as `…/page/[n]/`.

| Path | Lists |
|---|---|
| `/resources/` | Everything |
| `/resources/[type]/` | One type |
| `/resources/topic/[topic]/` | One topic |
| `/resources/[type]/topic/[topic]/` | One type within one topic |
| `/resources/[type]/[slug]/` | A single resource |

## Fixtures and test

`fixtures/valid/` and `fixtures/invalid/` hold example payloads named `<schema>.<case>.json`, where `<schema>` is the schema file name without `.schema.json`. The test in `test/` compiles every schema with Ajv in strict mode and asserts that every valid fixture passes and every invalid fixture fails, and that every payload schema has at least one of each. From the repository root:

```sh
pnpm --filter @colbitron/resource-hub-ui test
```

CI runs it in the gate on every pull request and push to `main`.

## Using the schemas

The package belongs to this repository's pnpm workspace and is never published ([ADR 0041](../../docs/adr/0041-the-shared-package-is-a-workspace-dependency.md)). A workspace package that needs it adds it to its `package.json` and runs `pnpm install` from the repository root, which links `packages/ui/` in:

```json
"dependencies": {
	"@colbitron/resource-hub-ui": "workspace:*"
}
```

The package exports `./schemas/*`, so a consumer imports a schema by file name. The import below uses import attributes (`with { type: 'json' }`), which need Node 22 or newer:

```js
import request from '@colbitron/resource-hub-ui/schemas/revalidate-request.schema.json' with { type: 'json' };
```

Register every schema with the validator under its `$id`, not only the one being checked. Schemas reference `common.schema.json` by relative `$ref`, and a `$ref` resolves against the referring schema's `$id`. Each `$id` is the file's raw URL on `main`, but it is an identifier, not a location: validators look it up among the schemas they were given and do not fetch it.

`rest_url` uses `format: uri`. Formats are not part of a draft 2020-12 validator's core: Ajv needs a formats plugin, `ajv-formats` (the test here calls `addFormats( ajv )`), and without one a validator either ignores `format` or throws on the unknown format when it compiles the schema. The `^https?://` pattern on `rest_url` holds either way.

## License

GPL-2.0-or-later, the same as the plugin.
