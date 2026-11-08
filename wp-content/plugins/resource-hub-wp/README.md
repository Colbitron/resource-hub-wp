# Resource Hub: WordPress plugin

For a contributor new to the plugin: how to run it, test it and find your way around. The rules an agent follows on every edit are in [`CLAUDE.md`](CLAUDE.md) beside this file; the project's architecture, contract and decisions are in the [root README](../../../README.md).

The plugin models a filterable resources library for a headless front end: the `resource` post type with its taxonomies and meta, three custom REST routes (resolve a slug, a page by path, and the resources related to one), the revalidation hook that tells the Next.js front end what changed, the lockdown that keeps the CMS's own pages for logged-in users, and the admin screens that show what happened. It is a demonstration of a pattern, written fresh, not production code.

## Directory map

```
resource-hub.php         plugin header, autoloader check, activation hook, boot
src/
  Plugin.php             wires every component onto WordPress hooks
  ContentModel/          post type, taxonomies, meta and its rules, permalinks, one-type rule,
                         required fields, reserved slugs, slug escapes, used-type protection
  Rest/                  resolve route, page route, related route and its salted cache, the no-cache
                         header on anonymous REST reads
  Revalidation/          events, queue, dispatcher, sender, results, config, PostHog
  Pages/                 page path rules shared by the page route and page events
  Lockdown/              anonymous visitors get a 404 from theme pages; robots, sitemaps, oEmbed
  Security/              XML-RPC off
  Admin/                 the status page, the list column, the term notice, result wording
  Editor/                enqueues the editor scripts below
  Cli/                   the two WP-CLI commands
  Seed/                  the seeder behind `wp resource-hub seed`
blocks/related-resources/  the block scaffold (editor only; the render callback is slice 4)
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
pnpm build                 # compiles blocks/ and editor/ into build/ (not committed)
pnpm wp resource-hub seed  # optional sample content
```

Log in at `http://localhost:8888/wp-admin` with `admin` / `password`. Activating the plugin deletes the stored rewrite rules so `/resources/…` permalinks work without a visit to Settings > Permalinks; `flush_rewrite_rules()` itself is forbidden by the VIP ruleset. If the URLs 404 later, `pnpm wp rewrite flush` is the manual equivalent.

The revalidation settings come from the `RESOURCE_HUB_FRONTEND_URL` and `RESOURCE_HUB_REVALIDATE_SECRET` constants, with `RESOURCE_HUB_POSTHOG_KEY` and `RESOURCE_HUB_POSTHOG_HOST` optional. Locally, define them in a gitignored `.wp-env.override.json` under `config`. Without them nothing is sent and every save records "not configured". Settings > Resource Hub shows which source is in force and has a test button; [`docs/architecture/revalidation.md`](../../../docs/architecture/revalidation.md) explains the rest.

`.wp-env.json` also maps `packages/ui` into the containers at the same path relative to the WordPress root, which is how PHPUnit reads the contract schemas. A change to `.wp-env.json` needs `pnpm env:start` again.

## WP-CLI commands

Both run through `pnpm wp` (the dev site) or `pnpm wp:tests` (the tests site).

- `wp resource-hub seed [--count=<n>]` seeds the five types, the topics and `--count` fictional resources (default `Seeder::DEFAULT_COUNT`, 12; the catalogue holds 16). Safe to rerun.
- Not a command of the plugin's, but the one-liner for the host after the required-fields rule: every published or scheduled resource that lacks a title, a topic or a summary (`RequiredFields::missing_stored()`), as ID and title, and nothing written. The editor keeps such a resource's Update button off until someone fills the gap.

  ```sh
  wp eval 'foreach ( get_posts( array( "post_type" => "resource", "post_status" => array( "publish", "future" ), "posts_per_page" => -1, "fields" => "ids" ) ) as $id ) { if ( ResourceHub\ContentModel\RequiredFields::missing_stored( $id ) ) { WP_CLI::line( $id . "\t" . get_post( $id )->post_title ); } }'
  ```

- `wp resource-hub decode-slugs [--apply]` lists every `resource` post and every term in the three taxonomies whose stored slug still holds a percent escape the front end's router decodes (one of `A-Z a-z 0-9 - _ . ! ~ * ' ( )`), with the decoded slug and anything already holding it. A dry run unless given `--apply`, which saves each through core (`wp_update_post()`, `wp_update_term()`), so the old slug is kept in `_wp_old_slug` and the front end is revalidated as on any save. A term whose decoded slug another term has is skipped and reported: core refuses it, and an editor must type a new slug. Slugs saved since the `SlugEscapes` rule need no repair; only a cron publish of a scheduled resource bypasses it, because it writes the status alone.

## Testing

Three gates, all run by `.github/workflows/ci.yml` on every pull request and push to `main`, and all run locally from the root:

| Command | Runs |
|---|---|
| `pnpm lint` / `pnpm lint:fix` | PHPCS / PHPCBF on WordPress Coding Standards as the base, the WordPress VIP Minimum ruleset on top, and the PSR-12 sniffs that do not conflict. Where WordPress and PSR-12 disagree, WordPress wins, and each exclusion in `phpcs.xml.dist` names the conflict. Warnings fail the gate: fix, do not silence. |
| `pnpm test:php` | PHPUnit 9.6 inside the WordPress core test library that wp-env provides. The pin follows that library: as of WordPress 7.1 it depends on `yoast/phpunit-polyfills` 1.x, whose ceiling is PHPUnit 9. Tests are written against polyfills 4.x, but `phpunit.xml.dist` uses PHPUnit 9 names (`convertDeprecationsToExceptions`, `<coverage>`), so when core raises its ceiling, moving the pin also needs the PHPUnit 10+ configuration migration. |
| `pnpm test:e2e` / `test:e2e:debug` | Playwright against the tests site on port 8889, with the WordPress e2e utilities. |
| `pnpm lint:js` / `pnpm format` | ESLint and Prettier with the WordPress presets on `admin/`, `blocks/`, `editor/` and `tests/e2e/`. |
| `pnpm test:schemas` | The contract's own test in `packages/ui`: Ajv compiles every schema in strict mode and checks every fixture. |

Things to know:

- **PHPUnit reinstalls the tests site.** The bootstrap drops and reinstalls the tests database, which deactivates every plugin there. CI runs PHPUnit before Playwright, and every Playwright spec imports `test` from `tests/e2e/fixtures.js`, a worker-scoped fixture that activates the plugin before any spec runs. The dev site on 8888 is untouched.
- **Publishing in a test takes all four fields.** A public resource needs a title, one type, a topic and a summary (`OneType`, `RequiredFields`), so a PHPUnit test that publishes through REST, and every Playwright spec that publishes, sends or stores them; `tests/e2e/required-fields.spec.js` covers the editor's notice, lock and checklist, with an axe scan of the sidebar through `@axe-core/playwright`, the workspace's accessibility scanner.
- **Payloads are validated against the shared schemas.** `tests/phpunit/Revalidation/SchemaValidator.php` registers every schema in `packages/ui/schemas/` under its `$id` with `opis/json-schema` (draft 2020-12, cross-file `$ref`s) and checks every payload a test builds. `SchemaTest` runs the package's `revalidate-request.*.json` fixtures through the PHP validator, so the two validators agree on the request schema. No PHP test runs the other schemas' fixtures, and Ajv's strict compile runs only under `pnpm test:schemas`. `opis/json-schema` is a dev dependency and is never shipped.
- **`build/` is not committed.** CI builds it before the gate runs; locally, run `pnpm build` (or `pnpm start` to watch) after `pnpm env:start`. `webpack.config.js` extends the `@wordpress/scripts` config with the non-block entries under `editor/` and `admin/`.
- **PHP 8.4 in wp-env, CI and on the host.** The declared floor (`Requires PHP`, `composer.json`, PHPCS `testVersion`) stays at 8.2 and is not exercised by CI.
- **WordPress 6.9 or newer** (`Requires at least`). The salted object-cache helpers behind the related route's cache (`wp_cache_set_salted()`, `wp_cache_get_salted()`) arrived in 6.9.

## What is not built yet

The block's render callback and its marker are the rest of slice 4; the related route (`GET /resource-hub/v1/related/{id}?count=n`) and the `related_picks` meta exist, with the editor's control for the picks in the Resource details panel, and the front end does not read them yet. The block directory holds an editor scaffold only. The CMS block theme is slice 5. The spec for both is in the slice-4 issue linked from the root README's status table.

## Possible next steps

Only once the core is green, in this order:

1. WPGraphQL alongside REST on the same types, so the choice between them has a live comparison.
2. Draft preview: a signed, expiring preview token the front end can exchange for draft content.
3. A second block using InnerBlocks.
