# Resource Hub: WordPress side

The CMS half of a two-repo headless WordPress demo. The other half is `../resource-hub-next` (Next.js on Vercel). Read both CLAUDE.md files before changing the contract in either.

## Standards to build to

Headless WordPress with Next.js over REST (GraphQL as a stretch); custom Gutenberg blocks and modular plugins to WordPress Coding Standards and PSR-12; Composer; GitHub Actions; PHPUnit and Playwright; WordPress VIP habits (no direct DB assumptions, object cache, no filesystem writes); WCAG and Core Web Vitals. Ambition here means depth, not feature count: a small system where every decision has a one-sentence reason.

## Hard constraints

- **No secrets in git.** The revalidation secret and front-end URL live in `.env` (gitignored) and in wp-env's `config` or `define()` overrides, never in a committed file.

## What it is

A WordPress plugin, `resource-hub`, plus a `wp-env` development environment, that models a filterable resources library and pushes changes to a Next.js front end.

**Core:**
1. Custom post type `resource` with taxonomies `resource_topic` and `resource_type`, all `show_in_rest`, REST base `resources`. Registered in the plugin, not a theme.
2. Post meta registered for REST with `register_post_meta` and sanitize and auth callbacks: `summary` (string), `source_url` (URL), `featured` (bool).
3. One custom REST route, `GET /resource-hub/v1/related/{id}`, returning related resources by shared topic, with a `permission_callback`, argument validation, and a cache-friendly response.
4. One dynamic Gutenberg block, `resource-hub/related-resources`, registered from `block.json` with a PHP `render_callback`, attributes `count` and `topic`. Server-rendered so the same HTML serves the editor preview and the classic front end.
5. The revalidation hook: on publish, update, or trash of a `resource` (hook on `transition_post_status` or `save_post_resource`, plus `wp_trash_post`), POST to the front end's `/api/revalidate` per the contract below. Handle every response code; store the last result in post meta `_rh_last_revalidation` and surface it as an admin notice. Never block the editor on a slow front end: fire after the save completes and time out at 5 seconds.
6. Tests and gates: PHPUnit (wp-env test suite) for the meta sanitizers, the REST route, the block render, and the revalidation payload and response handling (HTTP mocked); PHPCS on WordPress Coding Standards plus PSR-12; a Playwright smoke test against wp-env (create a resource, see the block render). All of it in GitHub Actions on every pull request and every push to `main`.
7. `composer.json` at the repo root managing PHPCS, the WordPress standards, PHPUnit, and the plugin's autoloader (PSR-4 under `src/`).
8. `README.md` with an architecture diagram and a decisions section; one ADR per real decision under `docs/adr/`.

**Stretch, in order, only once core is green:**
1. WPGraphQL alongside REST on the same types, so "which and why" has a live comparison.
2. Draft preview: a signed, expiring preview token the front end can exchange for draft content.
3. A second block using InnerBlocks.

## The contract with the front end

Change this only by changing both repos in the same sitting.

- **Content read:** the front end reads `GET /wp-json/wp/v2/resources?_embed&per_page=…&resource_topic=…&resource_type=…` and `GET /wp-json/wp/v2/resources/{id}`, plus the taxonomy endpoints. Meta appears under `meta` because of `show_in_rest`. Related items: `GET /wp-json/resource-hub/v1/related/{id}?count=3`.
- **Revalidation request** (WordPress to front end): `POST {FRONTEND_URL}/api/revalidate`, header `Authorization: Bearer {REVALIDATE_SECRET}`, header `Content-Type: application/json`, body:
  ```json
  { "type": "resource", "event": "publish" | "update" | "trash", "id": 123, "slug": "example", "rest_url": "https://cms.example/wp-json/wp/v2/resources/123", "topics": ["topic-slug"], "types": ["type-slug"] }
  ```
- **Revalidation response:** `200 { "revalidated": ["/resources", "/resources/example"] }`; `400 { "error": "…" }` for a malformed body; `401 { "error": "unauthorized" }` for a bad or missing bearer; `500 { "error": "…" }` when the front end fails. The plugin records status and body and shows them to the editor.
- **Configuration on this side:** `RESOURCE_HUB_FRONTEND_URL` and `RESOURCE_HUB_REVALIDATE_SECRET` as PHP constants (wp-config or wp-env `config`), falling back to options set on a small settings page.

## Standards and workflow

- PHP 8.4, matching the host (see ADR 0005). WordPress 6.7 or newer. WordPress Coding Standards, the WordPress VIP Minimum ruleset, and PSR-12 via PHPCS; fix, don't silence. Escape on output, sanitize on input, nonces and capability checks everywhere, `$wpdb->prepare` if raw SQL is ever justified (it should not be here). Object cache for the related query; no transients as storage; no filesystem writes at runtime.
- Agent-first build. The human reviews rather than writes: the critical paths (the revalidation hook, auth and permission callbacks, the sanitizers) get read line by line before merge; the rest goes through the gate. The gate is PHPCS, PHPUnit, Playwright, and a reviewer agent on a different model than the implementer. Nothing merges until all of it passes.
- Work on branches and open pull requests so the review has a diff to read. Small PRs, one concern each. Commit messages say what and why.
- Record each real decision as an ADR as it is made (REST route versus filtering on the client, `transition_post_status` versus `save_post`, server-rendered block versus React-rendered, cache strategy).
- **Local environment, decided 2026-11-03: `@wordpress/env` on Docker is the canonical environment.** `.wp-env.json` is committed and mounts the plugin; the same `wp-env` commands run the PHPUnit suite locally and in GitHub Actions. LocalWP is not used; a second environment would mean a second test setup to keep in step. Host toolchain as of 2026-11-03: Node 24 and pnpm present; Docker installed (start it first); no PHP, Composer, or WP-CLI on the host. Composer ships in the wp-env cli containers, so all PHP tooling runs there with no host install: `pnpm composer`, `pnpm lint`, `pnpm test:php` (see `package.json`). The container is the source of truth for test results.
- **Hosted CMS, decided 2026-11-03: Cloudways Flexible on a DigitalOcean 2 GB server, PHP 8.4** (ADR 0005). It is the site the Vercel front end reads and revalidates against. Deploys happen only from CI on `main` after the gate passes, by rsync over SSH into `wp-content/plugins/resource-hub-wp` (the same directory name as wp-env, so the plugin basename matches everywhere). Five repository secrets feed the job: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_KNOWN_HOSTS`. The two configuration constants are `define()`d in the host's `wp-config.php`.
- **PHPUnit resets the tests site.** The WordPress test bootstrap drops and reinstalls the tests database (port 8889) on every run, which deactivates every plugin there. The dev site (port 8888) is untouched. Every Playwright spec therefore activates the plugin itself in a `beforeAll` via `requestUtils.activatePlugin( 'resource-hub' )` and never assumes prior state; share that from a fixture once there is more than one spec. CI runs PHPUnit before Playwright for the same reason.
