# Resource Hub

A headless WordPress demo in one repository (ADR 0033): a WordPress plugin, a Next.js front end, and the contract package they share. This file holds what every session needs. Each part has a `CLAUDE.md` beside it with the rules for edits there: `wp-content/plugins/resource-hub-wp/CLAUDE.md` for the plugin and `apps/web/CLAUDE.md` for the front end. Rules for one area (revalidation, caching and redirects, the contract) live in `.claude/rules/` and load on their own when a matching file is read or edited. Read this file and the one for the part you are changing.

## Standards to build to

Headless WordPress with Next.js over REST (GraphQL as a stretch); React and TypeScript; custom Gutenberg blocks and modular plugins to WordPress Coding Standards and PSR-12; Composer; GitHub Actions; PHPUnit and Playwright; WordPress VIP habits (no direct DB assumptions, object cache, no filesystem writes); WCAG and Core Web Vitals. The reference shape is a headless WordPress site on Next.js and Vercel with ISR and on-demand revalidation from the CMS; this should look like a small, clean instance of that shape. Ambition here means depth, not feature count: a small system where every decision has a one-sentence reason, and a front end that is fast, accessible and tested.

## Hard constraints

- **Fresh, generic code only.** Nothing here may be copied or adapted from any prior employer's codebase or packages. Generic WordPress and Next.js patterns only; when in doubt, write it the textbook way and record the choice.
- **Never describe this as production code.** It is a demonstration of a pattern, written fresh.
- **No secrets in git.** On the CMS side, the revalidation secret and front-end URL live in `.env` (gitignored) and in wp-env's `config` or `define()` overrides; on the front end, `REVALIDATE_SECRET` and `WP_API_URL` live in `apps/web/.env.local` (gitignored) and in Vercel project settings. Never in a committed file.

## What it is

A filterable resources library: WordPress models it and pushes changes, Next.js renders it and rebuilds pages on demand.

- **The plugin**, `resource-hub`, at `wp-content/plugins/resource-hub-wp/`: the `resource` post type and its taxonomies and meta, the resolve and page REST routes, the revalidation hook, the lockdown that keeps the CMS's theme pages for logged-in users, and the settings status page. Registered in the plugin, not a theme. It runs in a `wp-env` environment configured at the repository root and is deployed to the hosted CMS. The related route and the `resource-hub/related-resources` block's render callback are slice 4 (issue #50); the block directory holds an editor scaffold only.
- **The front end**, a Next.js App Router app in TypeScript at `apps/web/`, deployed on Vercel: it renders the library, the CMS's static front page at `/` and every published page at its path from the WordPress REST API, always on its own server, and revalidates on demand when the CMS says so.
- **The contract package**, `@colbitron/resource-hub-ui` at `packages/ui/`: the JSON Schemas both sides check themselves against (ADR 0010) and the stylesheets both render with (`tokens.css`, `card.css`), consumed through the pnpm workspace and never published (ADR 0033).
- **The CMS theme, planned for slice 5**, at `wp-content/themes/resource-hub/`: a full block theme on the `packages/ui` tokens and CSS, for editors and logged-in previews only; anonymous visitors get a 404 (ADR 0031). The directory does not exist yet.
- **Documentation:** `README.md` at the root with the architecture diagram and the layout; one ADR per hard-to-reverse decision under `docs/adr/`; topic pages under `docs/architecture/`; procedures under `docs/runbooks/`.

## The contract between the CMS and the front end

`packages/ui/README.md` is the contract's only full statement; the JSON Schemas in `packages/ui/schemas/` are its source of truth (ADR 0010). Change a schema and its fixtures first, then that README, then the code on both sides. In one paragraph: the front end reads the core REST API and two custom routes (resolve by slug, page by path) on its server only, never in the browser, and rewrites every CMS URL it renders; WordPress POSTs a bearer-authenticated batch of 1 to 25 resource, term and page events to `{FRONTEND_URL}/api/revalidate/` from a cron request after the save, and the front end clears the union of each event's current and previous state. Public URLs are the same on both sites, always with a trailing slash; `topic` and `page` are reserved. Contract changes land in one pull request that touches both sides and the schemas, and stay additive, so the front end never breaks against a CMS one deploy behind.

## Where to read what

| For | Read |
|---|---|
| The contract: payloads, routes, events, tags, URLs, the secret rule, styles | `packages/ui/README.md` |
| How a change reaches the front end: hooks, cron, batching, results, the status page, the revalidate route | `docs/architecture/revalidation.md` |
| Caching, ISR, redirects, the cache key, measurements and known costs | `docs/architecture/caching.md` |
| Deploying, rolling back, rotating a secret, host notes | `docs/runbooks/deploy.md` |
| Running and testing the plugin, its WP-CLI commands, its directory map | `wp-content/plugins/resource-hub-wp/README.md` |
| Running and testing the front end, its configuration, routes and images | `apps/web/README.md`, `apps/web/e2e/README.md` |
| Why the system has its shape | `docs/adr/` (13 records) |
| Why one class or module does what it does | Its docblock |
| What is not built yet | Issue #50 (slice 4 and the theme notes) |

## Standards and workflow

- Each part's language and framework standards are in its own `CLAUDE.md`.
- Agent-first build. The code is written by agents and reviewed by a human: the critical paths get read line by line before merge (on the CMS, the revalidation hook, auth and permission callbacks, and the sanitizers; on the front end, the revalidate route and the data layer's parsing); the rest goes through the gate. The gate is PHPCS, PHPUnit and Playwright for the plugin; typecheck, lint, unit tests, Playwright with axe, the specimen's screenshots and Lighthouse CI for the front end; the schema test for `packages/ui`; and a reviewer agent on a different model than the implementer. Nothing merges until all of it passes.
- Work on branches and open pull requests so the review has a diff to read. Small PRs, one concern each. Commit messages say what and why.
- **Write an ADR only for a decision that is expensive to undo** (data model, contract, hosting, repository shape, caching model, deploy pipeline), **constrains later work across the system, and had real alternatives worth recording.** One decision per record, with the rejected options and the costs, under `docs/adr/` at the next free number. A decision that replaces another marks the old one superseded and keeps it; a record that absorbs a retired one lists it in its `merges:` frontmatter. A timeout, a tag list or tag map, a header value, a required block attribute, a tool version or a CSS choice is not an ADR, even when it matters; it goes in a docblock, a README or a topic page. When in doubt, don't write one. Everything else goes beside what it describes: part-level standards in that part's `CLAUDE.md` or README; contract semantics in `packages/ui/README.md`; how a subsystem works in `docs/architecture/`; a procedure in `docs/runbooks/`; the reasoning for one piece of code in its docblock or test name; an unbuilt spec or an open question in an issue.
- **wp-env is the one environment** (ADR 0033), locally and in CI, and its containers are the source of truth for test results. There is no PHP, Composer or WP-CLI on the host, so PHP tooling runs through the root's `pnpm` wrappers (`pnpm composer`, `pnpm lint`, `pnpm test:php`). Setup, ports and the other commands are in the root `README.md` and the plugin's `README.md`.
- **Deploys run only from CI on `main`: the CMS first, then the front end** (ADRs 0005, 0051). The front end never goes live ahead of the CMS it reads, which is why contract changes stay additive. Secrets, rollback and rotation are in `docs/runbooks/deploy.md`.
