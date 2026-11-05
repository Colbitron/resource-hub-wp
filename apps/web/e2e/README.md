# Front-end end-to-end tests

The specs in this directory run the built app (`next build && next start`) against a **mock CMS**, a small Node server in `mock-cms/` that answers the WordPress REST routes the front end reads. Front-end e2e never uses wp-env, Docker or the hosted CMS: the mock needs nothing but Node, so the same run works on a laptop and in CI, and a spec can change the CMS's data mid-test without touching a WordPress install.

## Running

From the repository root:

```sh
pnpm web:test:e2e
```

Playwright starts the mock first, then builds and starts the app with `WP_API_URL` pointing at the mock (`playwright.config.ts`). Chromium must be installed once: `pnpm exec playwright install chromium` in `apps/web`.

By default both servers are started fresh, and a port that is already taken fails the run rather than testing whatever answers on it. To iterate on a spec without rebuilding, opt in to reuse with `RH_E2E_REUSE=1`: leave `node e2e/mock-cms/main.mts` and `next start` running (with the same ports and environment the config would give them) and re-run `RH_E2E_REUSE=1 pnpm exec playwright test`. Reuse is never on in CI. A reused mock can be recognised: `GET /__mock/health` answers `{ ok, dir, build, pid, origin }`, where `dir` is the absolute path of the `mock-cms/` directory it runs from and `build` a SHA-256 of every file in that directory, its code and fixtures, read when the process started (`mock-cms/identity.mts`). `harness.spec.ts` fails when `dir` is not this checkout's, and when `build` differs from the files on disk now, which means the mock was started before its code last changed: stop it and run again. A reused app has no such check, so make sure the `next start` you leave running was built from this checkout.

Specs run in one worker, one file at a time (`workers: 1`, `fullyParallel: false`), because they all share one mock process and one app.

The mock's self-check, which proves every response passes the front end's reader schemas, is a unit test: `test/mock-cms.test.ts`, run by `pnpm web:test`.

## Ports and environment

| What | Default | Override |
| --- | --- | --- |
| The app under test (`next start`) | `3310` | `RH_WEB_PORT` |
| The mock CMS | `4010` | `RH_MOCK_CMS_PORT` |

The mock binds to `127.0.0.1` and names itself `http://127.0.0.1:4010` in every URL it emits; the app is started with `WP_API_URL=http://127.0.0.1:4010/wp-json`, `RH_FIXTURES=1` (the test-only pages under `app/fixtures/`) and `REVALIDATE_SECRET` set to the fixed test value in `mock-cms/config.mts` (`E2E_REVALIDATE_SECRET`), which `e2e/revalidate.spec.ts` sends as its bearer. Both come from `mock-cms/config.mts`, which the config, the specs and the mock share. The app's build makes no CMS request; it needs `WP_API_URL` only for the `/media/` rewrite, which in a test proxies the mock's uploads.

## What the mock serves

Public routes, shaped like a real WordPress running the plugin (the captured fixtures in `test/fixtures/wp/` are the reference), with WordPress's `WP_Error` bodies for 400s and 404s. Every response from the resources, taxonomy and `resource-hub/v1` routes, errors included, carries `Cache-Control: no-cache, must-revalidate, max-age=0`, as the plugin's filter sends it (ADR 0023). `Allow: GET` is on every response from a matched route whose anonymous permission check passes, as `rest_send_allow_header()` adds it: the collections, a readable item and the plugin's routes, but not a missing or unreadable item.

Query parameters are read as PHP and core read them: `name[]=` arrays as well as comma lists, and the last value of a repeated `name=`. Bad ones get core's 400 `rest_invalid_param`, in core's two stages. First the arguments with a `validate_callback`, which are only `page` and `per_page`: when either fails, the 400 names those alone. Otherwise every other argument is validated as it is sanitized (`rest_parse_request_arg()`, and `sanitize_post_statuses()` for `status`), and the 400 names every failure, in the order the query string gives the parameters. Each failure is keyed by the parameter's name, an array item's included (`include=1,x` fails as `include`, with `include[1] is not of type integer.`), and carries core's code in `data.details` (`rest_invalid_type`, `rest_out_of_bounds`, `rest_not_in_enum`, `rest_forbidden_status`, and for the term filters, whose schema is `oneOf` a list and an object, `rest_no_matching_schema` and `rest_one_of_multiple_matches`). `test/mock-cms.test.ts` holds core 7.1.4's own responses as the expected bodies. `_embed` follows `rest_parse_embed_param()`: absent embeds nothing; empty, `0`, `1` or `true` embeds everything; any other value is a list of link relations (`_embed=wp:term`), so `_embed=false` embeds nothing.

- `GET /wp-json/wp/v2/resources` with `_embed`, `per_page` (1 to 100, default 10), `page`, `slug` (cleaned with `sanitize_title_for_query()`, as `WP_Query` cleans `post_name__in`, before matching), `include`, `order`, `orderby` (core's whole enum: `author`, `date`, `id`, `include`, `modified`, `parent`, `relevance`, `slug`, `include_slugs`, `title`), `status`, and the `resource_topic`, `resource_type` and `resource_flag` term-ID filters. `X-WP-Total`, `X-WP-TotalPages` and `Link` headers; a page past the end is core's 400 `rest_post_invalid_page_number`; `orderby=include` with no `include` is core's 400 `rest_orderby_include_missing_include`, and `orderby=relevance` is core's 400 `rest_no_search_term_defined`, as the mock serves no `search`; any `status` but `publish`, known or not, is a 400 `rest_invalid_param` whose `details.status` is core's `rest_forbidden_status` with status 401, as `sanitize_post_statuses()` refuses a reader who cannot edit posts before it checks the enum.
- `GET /wp-json/wp/v2/resources/{id}`: 404 `rest_post_invalid_id` for no such post, 401 `rest_forbidden` ("Sorry, you are not allowed to do that.") for a draft or trashed one, as core answers an anonymous reader.
- `GET /wp-json/wp/v2/resource_topic`, `resource_type` and `resource_flag` with `slug` (cleaned with `sanitize_title()`, as `get_terms()` cleans it), `include`, `per_page`, `page`, `order`, `orderby` (core's whole enum: `id`, `include`, `name`, `slug`, `include_slugs`, `term_group`, `description`, `count`), `hide_empty`, and `/{id}`. `count` is the number of published resources with the term. Unlike the resources collection, a page past the end is a 200 with `[]` and the totals headers, as core's terms controller has no page-number check.
- `GET /wp-json/resource-hub/v1/resolve?slug=…`: `{ id, type, slug }` for a published resource by its current or an old slug, otherwise the plugin's 404 `resource_hub_not_found`. The slug is cleaned as `sanitize_title()` cleans it (`mock-cms/sanitize.mts`, which lists what it leaves out), as are the terms' `slug` filter and the slugs the control endpoints derive or accept.
- `GET /wp-json/resource-hub/v1/related/{id}?count=…`: `{ items: [{ id, source }] }` (`related-response.schema.json`). It lists the published picks first, in order, then the newest published resources sharing one of the source's topics, never the source and never an ID twice, at most `count` items. A source with no topics gets its picks alone. `count` is 1 to 10, default 3, and anything else is a 400 `rest_invalid_param`. An ID that is not a published resource is a 404 `resource_hub_not_found`, a code the mock chose because the plugin's route is not written yet.
- `GET /wp-content/uploads/…`: the files under `mock-cms/fixtures/uploads/`, which `/media/…` on the app proxies.
- Anything else is a 404, as the CMS's theme answers anonymous visitors (ADR 0031).

The seed (`mock-cms/seed.mts`) has 14 published resources across 5 types and 5 topics, with the captured term IDs, so there is more than one page at the default `per_page`; a resource with no image, one with an SVG image with no dimensions, one whose image has a `sizes` entry; and one (`revalidation-from-the-editors-chair`, ID 33) whose body carries CMS links, an image with a `srcset` and the related-resources block marker. There is also one draft (ID 34), which no listing shows. ID 33's picks are that draft, a resource from another topic (29) and one that also shares a topic (21), and ID 24 picks 26.

## Control endpoints

Under `/__mock/`, a path the front end never requests. JSON in and out; errors are a 4xx `{ "error": "…" }`. `mock-cms/client.mts` wraps them for specs: `const cms = mockCms(); await cms.reset();`.

| Endpoint | Does |
| --- | --- |
| `GET /__mock/health` | `{ ok: true, dir, build, pid, origin }`: what Playwright waits for, and which mock answered, from which code |
| `GET /__mock/state` | Every resource (term slugs, status, previous slugs, picks), term and media item |
| `POST /__mock/reset` | Back to the seed, counters cleared |
| `POST /__mock/resources` `{ title, type, slug?, topics?, featured?, summary?, sourceUrl?, content?, mediaId? }` | Publishes a new resource |
| `POST /__mock/resources/{id}/title` `{ title }` | Changes the title and nothing else, as an editor's save does |
| `POST /__mock/resources/{id}/slug` `{ slug }` | Renames the slug; the old one resolves |
| `POST /__mock/resources/{id}/type` `{ type }` | Changes the type |
| `POST /__mock/resources/{id}/topics` `{ topics: [] }` | Replaces the topics |
| `POST /__mock/resources/{id}/status` `{ status }` | `draft` unpublishes, `trash` trashes, `publish` restores |
| `POST /__mock/resources/{id}/picks` `{ picks: [] }` | Replaces the editor's picks for the related route. Duplicates and the resource itself are dropped and the list is capped at 10, as the plugin does; an unknown ID is a 422 |
| `POST /__mock/terms/{taxonomy}/{id}` `{ slug?, name? }` | Renames a term |
| `DELETE /__mock/terms/{taxonomy}/{id}` | Deletes it and takes it off every resource |
| `GET /__mock/requests` | `{ total, byPath }`: how often each public path with its query string was requested |
| `POST /__mock/requests/reset` | Clears the counters |

Control requests are never counted, so the counters show what the app did. Every spec should `reset()` in `beforeEach`, because the mock is one process shared by every test and specs that change the data must not assume another file's state.

**A reset does not clear the app's cache.** `/__mock/reset` puts the mock's data back, but the app under test keeps whatever its fetch Data Cache already holds, for as long as the app process runs. A page one test rendered can still be served from the cache in a later test after the mock has changed or been reset. Specs must not rely on a reset to clear it. Either give each test data of its own, such as distinct slugs from `createResource` or `renameSlug`, so no cached entry applies, or call the app's revalidate route for the tags or paths the test changed, as the CMS would.

## Fixture pages

Test-only routes under `app/fixtures/`, built only with `RH_FIXTURES=1`:

- `/fixtures/cards/`: `ResourceCard` with fixed props (`card.spec.ts`).
- `/fixtures/data-layer/`: the data layer against the mock, two pages of the library and one resource by slug, rendered on every request so the counters show the Data Cache (`data-layer.spec.ts`). With `?twice={id}` it also reads that resource by ID twice in one render, so the counters show the per-render memoization.
- `/fixtures/revalidate/`: one tagged, cached fetch of a seeded resource, rendered on every request, so the counters show the Data Cache keeping it and a `POST /api/revalidate/` for it making the next load fetch again (`revalidate.spec.ts`).
