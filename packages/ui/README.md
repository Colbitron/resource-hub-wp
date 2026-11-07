# @colbitron/resource-hub-ui

The contract between the Resource Hub WordPress plugin ([`wp-content/plugins/resource-hub-wp/`](../../wp-content/plugins/resource-hub-wp/)) and its Next.js front end ([`apps/web/`](../../apps/web/)), both in this repository, written once as JSON Schema (draft 2020-12) so both sides can check themselves against it ([ADR 0010](../../docs/adr/0010-contract-as-json-schema-in-a-shared-package.md)). PHPUnit in the plugin validates every payload it builds against these schemas; the front end proves its Zod readers against the same fixtures. When either side drifts from the schemas, its own test fails.

Every schema and every property carries a `description` that states what the value means, not only what type it is. The schemas are the contract; this file is the only full statement of the semantics a schema cannot express. Anything else that describes the contract summarises this file and links here.

Contract changes land in one pull request that touches both sides and the schemas, and they stay additive: add a field, route or event before anything relies on it, and remove the old one only after nothing does, so the front end never breaks against a CMS one deploy behind ([ADR 0033](../../docs/adr/0033-one-repository-for-the-plugin-the-front-end-and-the-contract.md)). Change a schema and its fixtures first, then this file, then the code on both sides.

## Schemas

| File | Describes |
|---|---|
| `schemas/revalidate-request.schema.json` | Body of `POST {FRONTEND_URL}/api/revalidate/`, WordPress to front end: a batch of resource, term and page events |
| `schemas/revalidate-response-ok.schema.json` | The `200` reply: the paths the front end revalidated |
| `schemas/revalidate-response-error.schema.json` | The `400`, `401` and `500` replies: `{ "error": "…" }`; `401` is exactly `unauthorized` |
| `schemas/related-response.schema.json` | `GET /wp-json/resource-hub/v1/related/{id}?count=n`: related resource IDs with the reason each was picked, merged on the CMS; the front end does not read it yet (see [Related items](#related-items)) |
| `schemas/resolve-response.schema.json` | `GET /wp-json/resource-hub/v1/resolve?slug=…`: an old or current slug to the resource's canonical id, type and slug |
| `schemas/page-response.schema.json` | `GET /wp-json/resource-hub/v1/page?path=…`: the published page the front end serves at a public path, with its canonical path, or `null` |
| `schemas/wp-error.schema.json` | The WordPress core REST error shape the custom routes return for `400` and `404` |
| `schemas/common.schema.json` | Shared `$defs` the others reference: `id`, `slug`, `typeSlug`, `topicSlug`, `typeList`, `topicList`, `path`, `pagePath` |

The bearer token on the revalidation request is a header and is not part of any schema. The stylesheets the package also holds are described under [Stylesheets](#stylesheets).

## How the two sides talk

**Server side only.** The front end makes every CMS request on the Next.js server, with the CMS's `/wp-json` base in `WP_API_URL`, a server-only environment variable (never `NEXT_PUBLIC_`), so the CMS's address never reaches the browser ([ADR 0040](../../docs/adr/0040-the-cms-url-never-reaches-the-browser.md)). WordPress emits absolute CMS URLs everywhere (`get_permalink()`, `content.rendered`, `_embed` media) and does no rewriting; the front end rewrites them while rendering: links lose the CMS domain, and images, including `<img src>` and `srcset` in `content.rendered`, become `/media/…`, which the front end rewrites to the CMS's uploads directory one to one. `/media/` is therefore part of the contract: a path under `wp-content/uploads/` is the same path under `/media/`. This reduces exposure; it is not a security boundary.

**Content reads.** `GET {WP_API_URL}/wp/v2/resources?_embed&per_page=…&page=…&resource_topic=…&resource_type=…&resource_flag=…`, `GET {WP_API_URL}/wp/v2/resources/{id}` and `?slug=`, the taxonomy endpoints `/wp/v2/resource_topic`, `/wp/v2/resource_type` and `/wp/v2/resource_flag`, and `GET {WP_API_URL}/wp/v2/pages/{id}`. Meta is `summary` and `source_url`, under `meta` because of `show_in_rest`. Featured is the `resource_flag` term `featured`, not meta: a featured resource has that term's ID in `resource_flag`. Anonymous responses from these routes and from `/resource-hub/v1/`, errors included, carry `Cache-Control: no-cache, must-revalidate, max-age=0` (the plugin's `NoCacheHeader`), so the front end's Data Cache is the only HTTP cache between the two sides.

**Custom routes.** `GET {WP_API_URL}/resource-hub/v1/resolve?slug=…`, `GET {WP_API_URL}/resource-hub/v1/page?path=…` and `GET {WP_API_URL}/resource-hub/v1/related/{id}?count=…` (described below; the front end does not read it yet). All have a public permission callback and answer errors in core's `WP_Error` shape, `{ "code", "message", "data": { "status" } }`, for 400 and 404.

**Revalidation request**, WordPress to front end: `POST {FRONTEND_URL}/api/revalidate/`, with the trailing slash like every front-end path (the slashless form is a 308 the plugin's sender does not follow), header `Authorization: Bearer {REVALIDATE_SECRET}`, header `Content-Type: application/json`, body a batch of 1 to 25 events:

```json
{ "version": 1, "events": [
  { "type": "resource", "event": "publish" | "update" | "unpublish" | "trash" | "delete", "id": 123, "slug": "example", "rest_url": "https://cms.example/wp-json/wp/v2/resources/123", "types": ["type-slug"], "topics": ["topic-slug"], "previous": { "slug": "old-example", "types": ["type-slug"], "topics": ["topic-slug"] } | null },
  { "type": "term", "taxonomy": "resource_topic" | "resource_type", "event": "create" | "update" | "delete", "id": 45, "slug": "topic-slug", "name": "Topic name", "previous": { "slug": "old-slug", "name": "Old name" } | null },
  { "type": "page", "event": "publish" | "update" | "unpublish" | "trash" | "delete", "id": 7, "path": "/about/team/", "previous": { "path": "/team/" } | null }
] }
```

**Revalidation response:** `200 { "revalidated": ["/resources/", "/resources/webinar/example/"] }` listing the paths revalidated (tags are not reported); `400 { "error": "…" }` for a malformed body; `401 { "error": "unauthorized" }` for a bad or missing bearer; `500 { "error": "…" }` when the front end fails, a missing or invalid secret included. The plugin records the status and body and shows them to the editor, so every message must be plain, accurate, and never quote a value. Every response carries `Cache-Control: no-store`.

## Semantics the schemas assume

**A revalidation request is a batch.** `{ "version": 1, "events": [ … ] }`, with 1 to 25 events. One WordPress PHP request produces one batch, so a bulk edit or a bulk trash in the admin is one request to the front end, not one per post. Events within a batch are deduplicated per resource ID for resource events, per (taxonomy, term ID) for term events and per page ID for page events, so a post and a term that share a numeric ID never merge; each group becomes one event carrying the earliest `previous` and the latest current state. A group that ends in `unpublish`, `trash` or `delete` after an `update` in the same request carries, at the top level, the state from before that update (for a term, its slug and name from before a rename), because that is the state the front end can have cached; `previous` stays `null`. A batch that would exceed 25 events is split into several requests.

**Resource events describe the public state the event concerns.** The top-level `slug`, `types` and `topics` are the state after the save for `publish` and `update`, and the last public state before removal for `unpublish`, `trash` and `delete` (or, after an `update` in the same request, the state before the request). A trashed post's slug is therefore the slug readers used, never the `__trashed` form WordPress renames it to. Changes that never touch public state send nothing: editing a draft, or restoring from the trash, which restores to draft. Permanently deleting a resource already in the trash sends nothing, because its `trash` event was already sent.

**`previous` is non-null only and always on `update`.** It holds the slug, type and topics (for a term event, the slug and name; for a page event, the path) from before the save, every field filled whether or not it changed, so the front end can also revalidate the listings and URL the item just left. When the resource's earlier types were not exactly one, as on the save that gives its one type to a resource saved outside the REST API, `previous.types` carries the current type in their place, with `previous.slug` and `previous.topics` kept. For every other event it is `null`: `publish` and `create` have no earlier public state, and the removal events already describe the last public state in the top-level fields.

**Term events** cover `create`, `update` and `delete` of `resource_topic` and `resource_type` terms, because renaming or deleting a term changes pages without saving any resource. `resource_flag` terms are managed in code and send none. An edit that changes neither slug nor name sends nothing. Assigning or removing terms on a resource is an `update` of that resource, not a term event. There is no topic redirect: an old topic URL is a 404 after a re-slug.

**The front end groups events.** `publish` and `update` mean refresh; `unpublish`, `trash` and `delete` mean remove, where its refetch of the resource returns nothing and the page becomes a 404. For every event it revalidates the union of the paths and cache tags implied by the current and the `previous` state, and never diffs the two. The tags are `resources`, `terms`, `resource:{slug}`, `topic:{slug}` and `type:{slug}` for resource and term events, and `pages` for page events, with every slug in WordPress's lower-case percent-encoded form. `terms` is produced only by term events and carried by every fetch that embeds or lists terms, so a term change reaches every page that shows the term; `pages` is produced only by page events and carried by every page lookup and read.

**A page event is about a public path.** `{ "type": "page", "event", "id", "path", "previous": { "path" } | null }` describes a WordPress page (post type `page`) the front end serves ([ADR 0052](../../docs/adr/0052-the-front-end-renders-the-cms-pages.md)): `path` is the page's public path in the state the event concerns, `/` for the static front page (Settings > Reading), else its parent chain and slug with a trailing slash (`/about/team/`, the `pagePath` definition). The five event names mean what they mean for a resource, and `previous` is set on `update` only, with the path before the save: a slug or parent change, and a page becoming or ceasing to be the front page (an `update` between its own path and `/`), are updates. A password put on a served page is an `unpublish`, and one taken off a `publish`. A parent's move or rename sends no event for its children, whose paths also changed; the front end clears one `pages` tag for every page lookup and read, so they follow. Posts send no events, and the front end never serves them.

**A page lookup is answered for the current state.** `GET /wp-json/resource-hub/v1/page?path=…` answers the static front page for `/`, else the published page whose parent chain is the path, else the one published page that has the last segment as its slug now (a page moved under another parent); a page that is not published or has a password, the posts page (`page_for_posts`, only while `show_on_front` is `page`) and an ambiguous slug are `null`. The answer's `path` is the page's canonical path now, `/` for the front page, so the front end redirects when it differs from what it asked for, after looking that path up as well. A miss is a 200 with `page: null`, not a 404, so the front end's Data Cache keeps it; a segment that sanitizes to nothing is a miss too. Only a `path` that is not a string or is over 2010 bytes is a 400, and the front end treats that, and a `rest_no_route` 404 from a CMS without the route, as a miss. A top-level page is never slugged `resources`, `api`, `media` or `_next`, the front end's own first segments: WordPress gives such a slug a suffix on save, and the front end answers such a path with a 404 without asking.

**Resolve answers for a published resource only.** `GET /wp-json/resource-hub/v1/resolve?slug=…` returns `{ "id", "type", "slug" }` for a published resource found by its current slug first, then by an old slug through core's `_wp_old_slug` record, or a 404 (`resource_hub_not_found`). `slug` is required, at most 200 bytes as sent, and run through `sanitize_title()`; empty once sanitized is a 400. The front end calls it only when its current-slug lookup misses, and sends the 308 itself. When an unpublished and a published resource both once had a slug, core's single match can be the unpublished one and the slug is a 404; that is pinned by a test, not fixed. A resource without exactly one type, or with a reserved one, is a 404.

**A resource has exactly one type.** `types` is a one-element array because the type is a URL segment and a resource has one canonical URL. The array form keeps the field the same shape as `topics`.

**Reserved type slugs.** A `resource_type` slug is never `topic` or `page`, because the front end's routes `/resources/topic/[topic]/` and `/resources/[type]/page/[n]/` would collide with a type of that name. WordPress refuses them on save; the schemas enforce it wherever a type slug appears: a resource event's `types` and `previous.types`, a term event's `slug` and `previous.slug` when its taxonomy is `resource_type`, and the resolve response's `type`. The front end's readers are stricter than these schemas on slugs that cannot be stored or put in a path: they also reject a dot segment (one or two dots, raw or percent-encoded), a lone surrogate, a slug longer than 200 characters once percent-encoded, a percent escape of a character Next.js decodes before a page sees the segment, which is `encodeURIComponent`'s unescaped set `A-Z a-z 0-9 - _ . ! ~ * ' ( )` (`case%2dstudy`, `%41bc`, `x%7ey`, `arti%27cle`, `a%2ab`), so the slug's own URL could never be served, and a type slug that is `topic` or `page` in any case. The CMS never stores such an escape in a `resource` post slug or in a term slug of the three taxonomies: it decodes them on save.

**`rest_url` is fetched, so the front end checks its host.** The schema pins its scheme to `http` or `https`, which rejects `javascript:`, `mailto:` and the like, but it cannot know the WordPress origin. Before fetching `rest_url` the front end must check that its host matches the WordPress origin it is configured with, and refuse it otherwise. That check is the guard against server-side request forgery, and it lives on the front end. Today the revalidate route fetches nothing at all and ignores `rest_url` after validating it.

**`topics` has no `maxItems`.** An extreme batch (25 events, each with very many topics) could produce a `200` listing more paths than fit in the plugin's 64 KB response limit, and the plugin would record a truncated answer for revalidation that did happen. Not a real case; if it becomes one, `topics` gets a `maxItems` on both sides.

## Reader policy

Strict where we produce, lenient on unknown keys where we consume ([ADR 0010](../../docs/adr/0010-contract-as-json-schema-in-a-shared-package.md)). The schemas keep `additionalProperties: false`, and a side checks what it produces against them exactly: the plugin its request and route responses, the front end its replies to the revalidation request. A side that reads a payload parses it with a variant that drops keys it does not know instead of rejecting them, every rule on a known key unchanged. The reason is the deploy order: the CMS deploys first and contract changes are additive, so for the length of one deploy the CMS can send a key the front end does not know yet, and a front end that answered it with a `400` would turn an additive change into a breaking one.

On the front end the exact mirror stays under a `…Strict` export, and it is the one the conformance tests prove against these fixtures, so an extra-key fixture is still rejected; the revalidate route and the data layer parse with the reader. The policy covers unknown keys only. A new value for an existing enum (an event name, an event `type`, a term `taxonomy`) is not additive: the reader rejects the whole batch with a `400`, so the front end must ship support for it before the CMS sends it, reversing the usual deploy order for that one change. Bumping `version` is not a way round that: the front end answers a `version` it does not understand with a `400` too. Whether an unreadable event should instead trigger a broad revalidation is open in [issue #51](https://github.com/Colbitron/resource-hub-wp/issues/51).

A collection the front end reads is parsed one item at a time, and a bad item is skipped rather than failing the listing, up to a threshold; `apps/web/lib/wp/fetch.ts` holds the rule. Flag terms are currently parsed as strictly as the other taxonomies ([issue #54](https://github.com/Colbitron/resource-hub-wp/issues/54)).

## Related items

The related route and the plugin's `related_picks` post meta exist on the CMS (`RelatedRoute`, `RelatedCache` and `Meta` in the plugin's `src/`), validated against `related-response.schema.json` and its fixtures. **The front end does not consume them yet**: its related section is the remaining part of [issue #50](https://github.com/Colbitron/resource-hub-wp/issues/50). The contract:

- `GET {WP_API_URL}/resource-hub/v1/related/{id}?count=3` (`count` 1 to 10, default 3) returns `{ "items": [ { "id": 12, "source": "pick" | "topic" } ] }`: at most `count` items, already merged, picks first in the editor's order, then the newest published resources sharing a topic, newest first and with no ranking by how many topics overlap, unpublished picks skipped, no duplicates, never the resource itself. A resource with no topics gets its picks alone; one with neither gets an empty list. A `count` out of range is a 400 and an ID that is not a published resource a 404, in core's `WP_Error` shape.
- **IDs only.** The front end will call it once, do no merging of its own, and read the objects with `GET {WP_API_URL}/wp/v2/resources?include={ids}&orderby=include&_embed`, so one code path renders a resource everywhere and no permalink has to be rewritten.
- The list is cached on the CMS under a salted object-cache key that any published resource's save, delete or topic change turns over; a change of picks on a published resource reaches the route on the next request after the save. The anonymous response carries the no-cache header like every other route here.
- `related_picks` is an ordered list of at most 10 post IDs, in the REST `edit` context only, for the editor's picker; the front end never reads it, and an anonymous read of `/wp/v2/resources` never includes it. A pick that is no longer published stays in the list and is skipped by the route.

## Block marker (not built yet)

The `resource-hub/related-resources` block's render callback is part of [issue #50](https://github.com/Colbitron/resource-hub-wp/issues/50); the front end's side of the seam exists in `apps/web/lib/content/render.tsx` and currently renders the fallback. The contract:

- The block renders `<div data-rh-block="related-resources" data-count="3" data-topic="topic-slug" data-topic-id="45" data-exclude="123">` around its `<h2>` heading and a fallback `<ul>` of links built with `get_permalink()`. The wrapper carries the `rh-related` class.
- `data-topic` is the term's current slug, resolved at render time from the stored term ID, and names the `topic:{slug}` cache tag; `data-topic-id` is that ID, for the `resource_topic` filter on `/wp/v2/resources`; `data-exclude` is the ID of the post the block sits in, left out of the list; `data-count` is 1 to 10.
- The front end parses `content.rendered` on its server, never in the browser, and swaps the wrapper for its own `<RelatedResources>` server component, fetched with the `topic:{slug}` tag, in the same pass that strips link domains and rewrites images to `/media/`. The marker never reaches the browser. A marker with an invalid attribute renders as the fallback.
- The marker's attributes, the heading and the shared class names are part of the contract. No shared JavaScript.

## Configuration

Names on each side, and the one rule both share. None of them is ever committed.

| Side | Variable | Holds |
|---|---|---|
| CMS | `RESOURCE_HUB_FRONTEND_URL` | The front end's origin, with no path; the plugin appends `/api/revalidate/`. A PHP constant, falling back to the option of the same name in lower case |
| CMS | `RESOURCE_HUB_REVALIDATE_SECRET` | The shared secret. Constant, falling back to the option |
| CMS | `RESOURCE_HUB_POSTHOG_KEY`, `RESOURCE_HUB_POSTHOG_HOST` | Optional; constants only. Unset, results logging is skipped |
| Front end | `WP_API_URL` | The CMS's `/wp-json` base, server-only |
| Front end | `REVALIDATE_SECRET` | The same secret as the CMS's |
| Front end | `SITE_URL`, `WP_MEDIA_ORIGIN` | The public origin, and an optional base for `/media/`; see `apps/web/README.md` |

**The secret's rule.** `REVALIDATE_SECRET` is 32 to 256 printable ASCII characters (0x21 to 0x7E) with no whitespace and no trailing newline, used exactly as defined, never trimmed. Both sides refuse anything else: the front end answers every request with a `500` that names the problem, and the CMS treats the secret as not configured and records why.

## Public URL shape

Both sides mirror this; it is not schema-validated. Every path has a trailing slash, every listing paginates as `…/page/[n]/`, and `topic` and `page` are reserved and never type slugs.

| Path | Lists |
|---|---|
| `/` | The static front page, or the front end's welcome page when none is set |
| `/[page]/…/` | A published WordPress page at its parent chain |
| `/resources/` | Everything |
| `/resources/[type]/` | One type |
| `/resources/topic/[topic]/` | One topic |
| `/resources/[type]/topic/[topic]/` | One type within one topic |
| `/resources/[type]/[slug]/` | A single resource |

The slug is the identity. On the front end, a wrong type segment, an old slug found through resolve, a wrong page parent or a non-canonical form redirects with a computed single-hop 308 that a browser is never allowed to keep; the CMS redirects no one, and its theme pages are a 404 for anonymous visitors, with `robots.txt` and `noindex, nofollow` on top ([ADR 0025](../../docs/adr/0025-permanent-redirects-are-computed-and-never-kept-by-browsers.md), [ADR 0031](../../docs/adr/0031-cms-theme-pages-are-for-logged-in-users.md)). `get_permalink()` stays absolute; the front end strips the CMS domain from every link in the HTML it renders.

## Stylesheets

The package also holds the stylesheets the CMS and the front end render with, and the one typeface, so the two sides look the same from one source. The `--rh-` tokens and the `rh-` class names are part of the contract: renaming one is a contract change, made on both sides in the same pull request. The visual system itself (what each token is for, the colour scheme, the type, motion, the components, how each consumer loads the CSS and the font, and how to change it) is written up once, in [`DESIGN.md`](DESIGN.md); the values are in `tokens.css` and nowhere else.

| File | Holds |
|---|---|
| `tokens.css` | Design tokens as custom properties on `:root`, all prefixed `--rh-` and named for their role, never for their value: colour as `light-dark()` pairs, the five mark accents, type, spacing, radius and measure. Every other stylesheet builds on these and defines no colour or size of its own. |
| `card.css` | The resource row: `.rh-card` and its parts (`__meta`, `__type`, `__body`, `__title`, `__link`, `__summary`, `__topics`, `__topic`) and `.rh-card-grid`, the list the rows sit in (the name is kept from the earlier card grid, so no consumer renames anything). It imports `card-labels.css` first, with a relative `@import`, so loading `card.css` loads the whole row; ship the two files side by side. The markup it expects is in the file's header comment: the meta line is a sibling before the body, and the row carries no image (`__media` is gone; nothing rendered it on the CMS side). `.rh-card__type` takes an optional `data-accent` attribute, one of `coral`, `cobalt`, `lemon`, `mint` or `grape`, which colours the type mark drawn before the name; any other value or none gives the neutral mark. The front end sets it from its type-accent table (`apps/web/lib/type-accents.ts`, keyed by the `resource_type` term's ID); a CMS consumer that renders the row sets it the same way or leaves it off. |
| `card-labels.css` | The row's two labels, `.rh-card__type` with its type mark (the `data-accent` rules above) and `.rh-card__topics` with `.rh-card__topic`, and their forced-colours rule: for a component that shows the labels without the row, as the front end's resource page does in its meta line, so it loads none of the row's layout. The class names are the row's; the markup is in the file's header comment. |
| `fonts/` | Figtree, one variable `woff2` on the weight axis (latin subset, the official Google Fonts release via `@fontsource-variable/figtree`), with its SIL Open Font License beside it. Each consumer loads it its own way, as `DESIGN.md` describes; no visitor's browser ever asks Google for it. Beside it, `figtree-fallback.css`: size-adjusted `@font-face` rules on system fonts (Arial and its clones Liberation Sans and Arimo, DejaVu Sans, Noto Sans, Roboto) that `--rh-font-sans` lists after Figtree, so a page drawn before the file lands takes nearly the space it will in Figtree; `scripts/figtree-fallback.mjs` derives and prints them. |

`tokens.css` must be loaded before the others; how each consumer loads them is in `DESIGN.md` (Consumers and loading), and the block's `block.json` does not load them yet. Adding a component stylesheet means a new `exports` entry in `package.json`, a line in `files`, and a header comment with the markup it expects; the related list (issue #50) renders the rows in `card.css`, so it needs none of its own. Import by file name:

```js
import '@colbitron/resource-hub-ui/tokens.css';
import '@colbitron/resource-hub-ui/fonts/figtree-fallback.css';
import '@colbitron/resource-hub-ui/card.css';
```

The package's tests (`pnpm --filter @colbitron/resource-hub-ui test`, or `pnpm test:schemas` from the root) also check the stylesheets: `test/contrast.test.js` resolves every colour token in both schemes and asserts WCAG AA for every text pair and 3:1 for the focus ring, `test/design-doc.test.js` fails when a token in `tokens.css` has no sentence in `DESIGN.md`, or the other way round, and `test/figtree-fallback.test.js` fails when `fonts/figtree-fallback.css` differs from what the script derives from Figtree's file, or `--rh-font-sans` lists its faces in another order.

## Fixtures and test

`fixtures/valid/` and `fixtures/invalid/` hold example payloads named `<schema>.<case>.json`, where `<schema>` is the schema file name without `.schema.json`. The test in `test/` compiles every schema with Ajv in strict mode and asserts that every valid fixture passes and every invalid fixture fails, and that every payload schema has at least one of each. From the repository root:

```sh
pnpm --filter @colbitron/resource-hub-ui test
```

CI runs it in the gate on every pull request and push to `main`. The plugin's PHPUnit runs the `revalidate-request` fixtures, and only those, through its own validator, so the two validators are known to agree on the request schema.

## Using the schemas

The package belongs to this repository's pnpm workspace and is never published ([ADR 0033](../../docs/adr/0033-one-repository-for-the-plugin-the-front-end-and-the-contract.md)). A workspace package that needs it adds it to its `package.json` and runs `pnpm install` from the repository root, which links `packages/ui/` in:

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
