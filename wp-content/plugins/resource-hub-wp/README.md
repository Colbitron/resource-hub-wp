# Resource Hub: WordPress plugin

For a contributor new to the plugin: how to run it, test it and find your way around. The rules an agent follows on every edit are in [`CLAUDE.md`](CLAUDE.md) beside this file; the project's architecture, contract and decisions are in the [root README](../../../README.md).

The plugin models a filterable resources library for a headless front end: the `resource` post type with its taxonomies and meta, four custom REST routes (resolve a slug, a page by path, the resources related to one, and a search of resources and pages), the revalidation hook that tells the Next.js front end what changed, the lockdown that keeps the CMS's own pages for logged-in users, the admin screens that show what happened, and the settings of Relevanssi, the search engine installed beside it from [`site-plugins/`](../../../site-plugins/README.md). It is a demonstration of a pattern, written fresh, not production code.

## Directory map

```
resource-hub.php         plugin header, autoloader check, activation hook, boot
src/
  Plugin.php             wires every component onto WordPress hooks
  ContentModel/          post type, taxonomies, meta and its rules, permalinks, one-type rule,
                         required fields, reserved slugs, slug escapes, used-type protection
  Rest/                  resolve route, page route, related and search routes with their salted
                         caches, the no-cache header on anonymous REST reads, RouteMatch (which route
                         and handler a request reached, for the content-model REST guards)
  Blocks/                the related-resources block: registration from build/ and the render callback;
                         TypeAccents, the shared type-accent table from build/type-accents.json
  Revalidation/          events, queue, dispatcher, sender, results, config, PostHog
  Pages/                 page path rules shared by the page route and page events
  Lockdown/              anonymous visitors get a 404 from theme pages; robots, sitemaps, oEmbed
  Security/              XML-RPC off; incoming trackbacks and pingbacks off for every post type;
                         no outgoing pingbacks, trackbacks, update-service pings or enclosure fetches
  Search/                Relevanssi's settings in code, its found_posts fix, the index build
  Admin/                 the status page, the list column, the term notice, result wording
  Editor/                enqueues the editor scripts below
  Cli/                   the three WP-CLI commands
  Seed/                  the seeder behind `wp resource-hub seed`
blocks/related-resources/  the block's editor source: block.json, edit.js and the stylesheet imports
editor/                  block-editor scripts: resource details panel with the related picks control,
                         type radios, required-fields notice and lock, revalidation notice
admin/status-page/       the status page's picker script
tests/phpunit/           PHPUnit, run inside the wp-env tests container
tests/e2e/               Playwright against the wp-env tests site
composer.json, phpcs.xml.dist, phpunit.xml.dist, package.json, webpack.config.js, playwright.config.js
```

Each class's docblock states its rules and why; read the docblock before changing a class.

## Running it

Requirements on the host machine: Docker, Node 24 and pnpm. PHP, Composer and WP-CLI run inside the wp-env containers; there is no host PHP. Everything runs from the repository root, where `.wp-env.json` is:

```sh
pnpm install               # the whole workspace
pnpm env:start             # WordPress at http://localhost:8888, the tests site at :8889
pnpm composer install      # inside the container; vendor/ lands in this directory
pnpm build                 # compiles blocks/, editor/ and admin/ into build/ (not committed), with the type-accent table; the block is registered from there
pnpm wp resource-hub seed  # optional sample content
pnpm wp resource-hub search-index --force  # rebuilds Relevanssi's index, since the seeder sets terms after saving
```

`pnpm env:start` also installs Relevanssi from `site-plugins/` and activates it on both sites; it builds the search index too once this plugin's `vendor/` exists, so on the first start, before `pnpm composer install`, it prints that it skipped it.

Log in at `http://localhost:8888/wp-admin` with `admin` / `password`. Activating the plugin deletes the stored rewrite rules so `/resources/…` permalinks work without a visit to Settings > Permalinks; `flush_rewrite_rules()` itself is forbidden by the VIP ruleset. If the URLs 404 later, `pnpm wp rewrite flush` is the manual equivalent.

The revalidation settings come from the `RESOURCE_HUB_FRONTEND_URL` and `RESOURCE_HUB_REVALIDATE_SECRET` constants, with `RESOURCE_HUB_POSTHOG_KEY` and `RESOURCE_HUB_POSTHOG_HOST` optional. Locally, define them in a gitignored `.wp-env.override.json` under `config`. Without them nothing is sent and every save records "not configured". The block editor shows each save's result in a notice on resources and pages; edit pages there, since a page saved in the Site Editor revalidates and records its result but shows no notice (`tests/e2e/site-editor-revalidation.spec.js`). Settings > Resource Hub shows which source is in force and has a test button; [`docs/architecture/revalidation.md`](../../../docs/architecture/revalidation.md) explains the rest.

`.wp-env.json` also maps `packages/ui` into the containers at the same path relative to the WordPress root, which is how PHPUnit reads the contract schemas. A change to `.wp-env.json` needs `pnpm env:start` again.

## WP-CLI commands

Each runs through `pnpm wp` (the dev site) or `pnpm wp:tests` (the tests site).

- `wp resource-hub seed [--count=<n>]` seeds the five types, the topics and `--count` fictional resources (default `Seeder::DEFAULT_COUNT`, 12; the catalogue holds 16). Safe to rerun.
- Not a command of the plugin's, but the one-liner for the host after the required-fields rule: every published or scheduled resource that lacks a title, a topic or a summary (`RequiredFields::missing_stored()`), as ID and title, and nothing written. The editor keeps such a resource's Update button off until someone fills the gap.

  ```sh
  wp eval 'foreach ( get_posts( array( "post_type" => "resource", "post_status" => array( "publish", "future" ), "posts_per_page" => -1, "fields" => "ids" ) ) as $id ) { if ( ResourceHub\ContentModel\RequiredFields::missing_stored( $id ) ) { WP_CLI::line( $id . "\t" . get_post( $id )->post_title ); } }'
  ```

- `wp resource-hub search-index [--force]` rebuilds Relevanssi's search index if it is out of date, and otherwise changes nothing: it empties the index, then indexes every published resource and page with its title, content, `summary` and topic and type names, the set `src/Search/RelevanssiConfig.php` selects. `--force` rebuilds a current index too. Fails when Relevanssi is not active. See [The search index](#the-search-index).
- `wp resource-hub decode-slugs [--apply]` lists every `resource` post and every term in the three taxonomies whose stored slug still holds a percent escape the front end's router decodes (one of `A-Z a-z 0-9 - _ . ! ~ * ' ( )`), with the decoded slug and anything already holding it. A dry run unless given `--apply`, which saves each through core (`wp_update_post()`, `wp_update_term()`), so the old slug is kept in `_wp_old_slug` and the front end is revalidated as on any save. A term whose decoded slug another term has is skipped and reported: core refuses it, and an editor must type a new slug. Slugs saved since the `SlugEscapes` rule need no repair; only a cron publish of a scheduled resource bypasses it, because it writes the status alone.

## The search index

Search runs on [Relevanssi](https://wordpress.org/plugins/relevanssi/), the free version, installed and pinned in [`site-plugins/`](../../../site-plugins/README.md). The plugin works without it: nothing in it needs Relevanssi, and `pnpm test:php` passes with it absent (below). Its settings live in code, in `src/Search/RelevanssiConfig.php`. The ones that decide what is indexed or whether a search writes are pinned with `pre_option_*` filters, so nothing is stored and Relevanssi's settings screen shows them but cannot change them: search logging off, admin searches left to core, only resources and pages indexed, the `summary` meta and the topic and type names indexed, no comments, author or excerpt, no shortcodes run at index time, Relevanssi's default word length and punctuation. The stopword list and a few settings that cannot matter here are left to the screen, and a change to them makes the next `search-index` rebuild. Through Relevanssi's own filters: every search query Relevanssi does not answer, the REST API's included, is left to core's search, and the related-resources block is never rendered into the index of the page that holds it, so a page that lists a resource does not match searches for that resource. A query asks for it with `'relevanssi' => true` beside `s`; `src/Search/RelevanssiFoundPosts.php` keeps such a query's `found_posts` right, which Relevanssi alone gets wrong for `fields => ids`.

Only published posts are indexed: a draft, pending, private or scheduled resource or page never reaches Relevanssi's tables, so a query against the index cannot return one by mistake. Relevanssi applies the same rule on every save, so publishing adds a post, and unpublishing, trashing or deleting it takes it out.

The index holds what those settings selected when it was built. `wp resource-hub search-index` compares a stamp of Relevanssi's version, its database version, the version its tables are at, those settings and the plugin's own index-logic version (`RelevanssiConfig::INDEX_LOGIC`, raised when a filter changes what is indexed), stored in the `resource_hub_search_index_stamp` option at the last complete build, and rebuilds only when it differs, Relevanssi has no complete index, or its tables are behind; it upgrades the tables first, as Relevanssi itself does only on an admin page load. The stamp is deleted when a rebuild starts and written when it completes, so an interrupted rebuild reads as stale. A rebuild empties the index first, so live search finds nothing or part of the library while it runs, which is why the deploy, which runs the command on every merge, must not rebuild a current index. Relevanssi has no full rebuild that skips the truncate (`src/Search/SearchIndex.php`). In practice:

1. **After Relevanssi is first activated** its tables are empty and it reports no complete index, so the next run rebuilds. `pnpm env:start` runs it on both wp-env sites; the deploy runs it on the host.
2. **After changing `RelevanssiConfig` (raise `INDEX_LOGIC` if the change is to a filter), or upgrading Relevanssi**, the stamp differs, so the next run rebuilds: locally `pnpm wp resource-hub search-index`, on the host the deploy that ships the change.
3. **After activating or deactivating Relevanssi or this plugin**, the stamp is deleted, since saves made meanwhile were indexed on Relevanssi's defaults or not at all, so the next run rebuilds.
4. **After renaming or deleting a topic or type**, nothing to do: `src/Search/TermReindex.php` re-indexes that term's published resources from WP-Cron, in sorted events of at most 50 a minute apart, or at once under WP-CLI.
5. **After a script assigns terms to posts it saved earlier**, as the seeder does, run `search-index --force`: Relevanssi re-indexes a post on save, not on a later term assignment.

The whole command took under a second for the 17 seeded resources and published page, WP-CLI's start-up included. Relevanssi keeps its index in its own tables (`wp_relevanssi` and two more); it writes no files. It also keeps a copy of each post it reads for the rest of the request and never refreshes it, so `src/Search/RelevanssiPostCache.php` drops a post's copy whenever core cleans its own cache; without that, a post published in the same request it was read in as a draft stays out of that request's searches.

## Testing

Three gates, all run by CI on Depot CI (`.depot/workflows/ci.yml`, the `gate` job) on every push to `main` and every pull request that changes `wp-content/` or a shared path (`docs/runbooks/deploy.md`, "Which jobs a pull request runs"), and all run locally from the root:

| Command | Runs |
|---|---|
| `pnpm lint` / `pnpm lint:fix` | PHPCS / PHPCBF on WordPress Coding Standards as the base, the WordPress VIP Minimum ruleset on top, and the PSR-12 sniffs that do not conflict. Where WordPress and PSR-12 disagree, WordPress wins, and each exclusion in `phpcs.xml.dist` names the conflict. Warnings fail the gate: fix, do not silence. |
| `pnpm test:php` | PHPUnit 9.6 inside the WordPress core test library that wp-env provides. The pin follows that library: as of WordPress 7.1 it depends on `yoast/phpunit-polyfills` 1.x, whose ceiling is PHPUnit 9. Tests are written against polyfills 4.x, but `phpunit.xml.dist` uses PHPUnit 9 names (`convertDeprecationsToExceptions`, `<coverage>`), so when core raises its ceiling, moving the pin also needs the PHPUnit 10+ configuration migration. |
| `pnpm test:e2e` / `test:e2e:debug` | Playwright against the tests site on port 8889, with the WordPress e2e utilities. |
| `pnpm lint:js` / `pnpm format` | ESLint and Prettier with the WordPress presets on `admin/`, `blocks/`, `editor/` and `tests/e2e/`, and on the CMS theme's `scripts/` (`lint:js:theme`, `format:theme`, run from the repository root so the workspace keeps one `@wordpress/scripts`). |
| `pnpm test:schemas` | The contract's own test in `packages/ui`: Ajv compiles every schema in strict mode and checks every fixture. |

Things to know:

- **PHPUnit reinstalls the tests site.** The bootstrap drops and reinstalls the tests database, which deactivates every plugin there. CI runs PHPUnit before Playwright, and every Playwright spec imports `test` from `tests/e2e/fixtures.js`, a worker-scoped fixture that activates the plugin, Relevanssi and the `resource-hub` theme before any spec runs. The dev site on 8888 is untouched.
- **PHPUnit loads Relevanssi.** The bootstrap loads it beside the plugin and creates its tables once the database is reinstalled, so the search tests in `tests/phpunit/Search/` run against the version `site-plugins/` installed, and fail if it is missing. To show the plugin works without it, run `pnpm exec wp-env run tests-cli --env-cwd=wp-content/plugins/resource-hub-wp env RESOURCE_HUB_TESTS_WITHOUT_RELEVANSSI=1 composer test`: the search tests skip and everything else passes. The index build truncates and analyzes its table, which would commit a test's transaction, so the search tests swap those two statements for transaction-safe ones (the test's docblock).
- **Publishing in a test takes all four fields.** A public resource needs a title, one type, a topic and a summary (`OneType`, `RequiredFields`), so a PHPUnit test that publishes through REST, and every Playwright spec that publishes, sends or stores them; `tests/e2e/required-fields.spec.js` covers the editor's notice, lock and checklist, with an axe scan of the sidebar through `@axe-core/playwright`, the workspace's accessibility scanner.
- **Payloads are validated against the shared schemas.** `tests/phpunit/Revalidation/SchemaValidator.php` registers every schema in `packages/ui/schemas/` under its `$id` with `opis/json-schema` (draft 2020-12, cross-file `$ref`s) and checks every payload a test builds. `SchemaTest` runs the package's `revalidate-request.*.json` fixtures through the PHP validator, so the two validators agree on the request schema. No PHP test runs the other schemas' fixtures, and Ajv's strict compile runs only under `pnpm test:schemas`. `opis/json-schema` is a dev dependency and is never shipped.
- **`build/` is not committed.** CI builds it before the gate runs; locally, run `pnpm build` (or `pnpm start` to watch) after `pnpm env:start`. `webpack.config.js` extends the `@wordpress/scripts` config with the non-block entries under `editor/` and `admin/`.
- **The block is registered from `build/`, not `blocks/`.** The deploy syncs `src/`, `build/` and `vendor/` and leaves `blocks/` behind, so `RelatedResourcesBlock` reads `build/related-resources/block.json`; without a build the block is not registered, and `RelatedResourcesBlockTest` fails on its first assertion. Run `pnpm build` before `pnpm test:php` and `pnpm test:e2e`, as CI does. The block's stylesheet is the shared package's `card.css` (`@colbitron/resource-hub-ui`, a workspace dev dependency of the plugin), imported by `blocks/related-resources/style.css` and inlined by the build into `build/related-resources/style-index.css`, which the compiled `block.json` names as the block's `style` after the `resource-hub-tokens` handle, so core enqueues the tokens and the row only where the block is used; it styles the block's resources, which render as `card.css` rows. The tokens handle is shared with the CMS theme, so a page with the block on the theme loads `tokens.css` once: the theme registers it, and `SharedTokens` registers the plugin's own copy, `build/shared/tokens.css` (which `webpack.config.js` copies from the package byte for byte), at a later `init` priority only when no theme has. On the CMS's own pages, WordPress 7.1.4 enqueues the style only where an instance renders something: a block whose callback renders nothing (no topic, or a deleted one) brings no block CSS, as measured on wp-env. In the editor core loads every registered block's style regardless.
- **PHP 8.4 in wp-env, CI and on the host, and 8.4 is the declared floor** (`Requires PHP`, `composer.json`, PHPCS `testVersion`), so the floor is the version CI tests. The floor was 8.2 until the locked dev toolchain needed 8.4 (ADR 0005, amended 2026-11-07).
- **WordPress 6.9 or newer** (`Requires at least`). The salted object-cache helpers behind the related route's cache (`wp_cache_set_salted()`, `wp_cache_get_salted()`) arrived in 6.9.

## What is not built yet

Slice 4 is built: the related route (`GET /resource-hub/v1/related/{id}?count=n`) and the `related_picks` meta, the editor's control for the picks in the Resource details panel, and the `resource-hub/related-resources` block, whose render callback writes the contract's marker (`packages/ui/README.md`, "Block marker") with card rows inside; the front end reads the route for its related section and swaps the marker for its own list. The CMS block theme is slice 5 ([issue #89](https://github.com/Colbitron/resource-hub-wp/issues/89)); its skeleton and its assets are at `wp-content/themes/resource-hub/`, and this plugin's PHPUnit and Playwright suites check its files, its 404, its copies of the contract package's assets, its `theme.json` presets against the tokens, and its stylesheets on a page with the block. Search is its own slice ([issue #115](https://github.com/Colbitron/resource-hub-wp/issues/115)): Relevanssi is installed, configured and indexed, and the search route queries it; the front end's search page at `/search/` reads it, and the theme's search template is not built yet. Open follow-ups are issues [#85](https://github.com/Colbitron/resource-hub-wp/issues/85) and [#87](https://github.com/Colbitron/resource-hub-wp/issues/87), the last the related list's scale path.

## Possible next steps

Only once the core is green, in this order:

1. WPGraphQL alongside REST on the same types, so the choice between them has a live comparison.
2. Draft preview: a signed, expiring preview token the front end can exchange for draft content.
3. A second block using InnerBlocks.
