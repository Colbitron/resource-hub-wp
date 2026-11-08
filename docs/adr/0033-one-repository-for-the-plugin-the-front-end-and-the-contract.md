---
status: accepted
date: 2026-11-04
merges: 0001 and 0041 (2026-11-06)
amended:
  - 2026-11-07
  - 2026-11-07
  - 2026-11-07
  - 2026-11-08
  - 2026-11-08
---

# One repository holds the plugin, the front end and the contract package, in one pnpm workspace, with wp-env as the only local environment

The demo began as two repositories, one per side, with the plugin at this one's root. The contract between them then became a package, `@colbitron/resource-hub-ui`, holding the JSON Schemas both sides check themselves against (ADR 0010) and the stylesheets both render with. Every real change to that package is a change to both consumers in the same sitting: a new event shape needs the PHP that builds it, the Zod that parses it, and the fixtures that prove both. Two repositories make that one change into two or three pull requests that land in order with a package publish between them, and a reviewer who reads one side at a time.

**The repository is one pnpm workspace** holding all three: the plugin at `wp-content/plugins/resource-hub-wp/`, the path WordPress loads it from, with the same directory name in wp-env and on the host so the plugin basename matches everywhere; the front end at `apps/web/`, imported with its history; the package at `packages/ui/`. One lockfile. `pnpm-workspace.yaml` lists `wp-content/plugins/*`, `apps/*` and `packages/*`.

**The package is a workspace dependency and is never published.** Every consumer is inside the repository and takes it as `"@colbitron/resource-hub-ui": "workspace:*"`; `packages/ui/package.json` is `"private": true` with no publish workflow, registry token or install variable. A contract change (schema, fixtures, the PHP that builds a payload, the Zod that parses it, a class name) is one pull request, with no version to bump or pin, and both consumers always build against the same commit.

**wp-env on Docker is the only local environment.** `.wp-env.json` at the root is committed and mounts the plugin from its path; the same `wp-env` commands run the PHPUnit suite on a laptop and in GitHub Actions, and the container is the source of truth for every result. LocalWP would mean a second environment and a second test setup to keep in step.

## Considered options

- **Two repositories and a published package.** Rejected: each contract change becomes an ordered sequence of pull requests with a publish in the middle, and the review that matters, the one that reads both sides at once, has no single diff.
- **Git submodules or subtrees mirroring the package.** Rejected: a mirror has a version to bump and can lag, which is the drift the package exists to prevent.
- **A third repository for the package alone.** Rejected in ADR 0010.
- **Keep publishing to GitHub Packages for a future outside consumer.** Rejected: no such consumer exists, and a publish path nothing exercises is a token to rotate for no reader. If one appears, publishing is a new decision.
- **A public package on npmjs.** Rejected: the owner does not want an internal contract discoverable as a general-use package, and with every consumer in the workspace it would buy nothing.
- **LocalWP for the laptop.** Rejected: a second test setup for CI.

## Consequences

- The plugin stays self-contained for PHP: its `composer.json`, PHPCS and PHPUnit configuration and tests live with it, and the deploy's rsync runs from the plugin directory with an allowlist, so nothing else in the workspace reaches the host. `packages/` never ships; once the plugin builds its CSS from the package, that CSS reaches WordPress through `build/`.
- The front end keeps its own ESLint, TypeScript and scripts; nothing at the root is shared between the two sides, so neither set of rules leaks into the other.
- CI has a `web` job beside the CMS gate. The CMS deploy waits for the CMS gate only; the front end's production deploy waits for both (ADR 0051).
- There is no host PHP, Composer or WP-CLI: Docker must be running, and the root `package.json` wraps the container commands. wp-env's tests site is reinstalled by every PHPUnit run, which deactivates plugins there, so the Playwright specs activate the plugin themselves.
- `"private": true` makes `pnpm publish` refuse, so an accidental publish fails instead of leaking the package. Vercel installs the workspace from the checkout with the Root Directory set to `apps/web`, so the link needs no registry access.
- `wp-content/themes/` is absent until the CMS theme arrives; it will take the same tokens and CSS through the workspace.

## Amendments

### 2026-11-07: CI runs on Depot CI

**What changed.** CI runs on Depot CI (ADR 0053), not GitHub Actions, because GitHub's free plan ran out of minutes and an Actions outage would stop every merge and deploy. So "in GitHub Actions" under the wp-env decision now reads "on Depot CI": the same `wp-env` commands run the PHPUnit suite there, and wp-env is still the one environment, locally and in CI. The front end's single `web` job under Consequences is now parallel jobs beside the CMS gate: the checks, the end-to-end suite, the screenshots, the Lighthouse shards and the job that merges their medians. The CMS deploy still waits for the CMS gate only, and the front end's production deploy for the CMS deploy and every front-end job (ADR 0051).

**What did not.** The decision is unchanged: one repository and one pnpm workspace hold the plugin, the front end and the contract package, which is never published, with wp-env on Docker as the only environment and its containers the source of truth for every result.

### 2026-11-07: the CMS theme's skeleton exists

**What changed.** `wp-content/themes/resource-hub/` now exists as a block theme skeleton, so "absent until the CMS theme arrives" under Consequences no longer holds. wp-env mounts it and activates it on both sites, and the Playwright fixture now activates the theme as well as the plugin, because PHPUnit's reinstall resets the tests site's theme. Its tokens, CSS and fonts come in a later slice-5 pull request, and, like the plugin's, they reach WordPress through a build, because the host never sees the workspace; that corrects "through the workspace". The deploy that ships the theme to the host is a later pull request too.

**What did not.** The decision is unchanged: one repository and one pnpm workspace hold the plugin, the front end and the contract package, with wp-env as the only environment.

### 2026-11-07: the workspace also lists the CMS theme

**What changed.** `pnpm-workspace.yaml` now also lists `wp-content/themes/*`, so "lists `wp-content/plugins/*`, `apps/*` and `packages/*`" above no longer holds. The CMS theme at `wp-content/themes/resource-hub/` is a workspace package so that it takes `@colbitron/resource-hub-ui` as `workspace:*`, like every other consumer, and its build copies the tokens, the lockup's stylesheet, Figtree and its fallback faces from `packages/ui` into the theme's own `build/`, which the host is given.

**What did not.** The decision is unchanged: one repository and one pnpm workspace hold the plugin, the front end and the contract package, which is never published, with wp-env as the only environment.

### 2026-11-08: the deploy also syncs Relevanssi

**What changed.** The search engine is Relevanssi, the free WordPress plugin (issue #115), and the CMS deploy now syncs it to the host as well as the plugin. It is the one third-party plugin: a small Composer project, `site-plugins/`, pins it to an exact version in its lockfile and installs it from wpackagist into `wp-content/plugins/relevanssi/`, which is gitignored. Before anything is sent, the deploy checks every installed file against the SHA-256 that WordPress.org publishes for that version, since the lock pins the archive's URL but cannot pin its hash, and then rsyncs that one directory into the same path on the host. So the sentence under Consequences, "the deploy's rsync runs from the plugin directory with an allowlist, so nothing else in the workspace reaches the host", now has this one exception: Relevanssi's installed directory reaches the host too, through its own rsync to a fixed target.

**Why.** Relevanssi belongs to the site, not to the plugin, so it is not in the plugin's `composer.json`, and `site-plugins/` keeps it out of the plugin's production `vendor/`, which ships only what the plugin itself needs.

**Options weighed.**

- **A root `composer.json`.** Rejected: running it in wp-env would mean mapping the whole repository under the containers' web root, where Apache would serve it, `.env` files included.
- **The plugin's own `composer.json` and `vendor/`.** Rejected: it would make a site-wide plugin a dependency of ours, and put a WordPress plugin into the production `vendor/` that the plugin's allowlist ships.
- **A manual install on the host.** Rejected: an untracked version that wp-env, CI and the tests could not reproduce, and a step outside the repository.

**What did not.** The decision is unchanged: one repository and one pnpm workspace hold the plugin, the front end and the contract package, with wp-env as the only environment. The plugin's own rsync keeps its allowlist, and `site-plugins/` itself, with its `vendor/`, never reaches the host, nor does `packages/`.

### 2026-11-08: the deploy also ships and activates the CMS theme

**What changed.** The CMS deploy now syncs the block theme at `wp-content/themes/resource-hub/` into the same path on the host and activates it on every deploy, as it does the plugin. Three statements above no longer hold as written:

- Under Consequences, "the deploy's rsync runs from the plugin directory with an allowlist, so nothing else in the workspace reaches the host": the theme's directory reaches the host too, through its own allowlist rsync from that directory (`style.css`, `theme.json`, `functions.php`, `inc/`, `templates/`, `parts/`, `assets/`, `js/` and the built `build/`) to a fixed target, so its `--delete` can reach no other theme.
- In the 2026-11-07 amendment "the CMS theme's skeleton exists", "The deploy that ships the theme to the host is a later pull request too": that deploy is now built.
- In the 2026-11-08 amendment "the deploy also syncs Relevanssi", "this one exception": there are now two, Relevanssi's installed directory and the theme's.

**Why.** The theme's 404 is the one theme page anonymous visitors get (ADR 0031), and the host's previous theme, Twenty Twenty-Five, listed the site's published pages on it. Activating the theme on every deploy, not once, keeps the host on it even after a theme switch in the admin, and keeps logged-in previews drawn with the front end's styles.

**Options weighed.**

- **A one-time manual upload and activation.** Rejected: an untracked copy that CI could not reproduce, and a step outside the repository.
- **Activating only on the first deploy.** Rejected: a later switch in the admin would quietly bring back a 404 that lists pages.

**What did not.** The decision is unchanged: one repository and one pnpm workspace hold the plugin, the front end and the contract package, with wp-env as the only environment. `packages/` never reaches the host: the theme takes the package's files only as the copies its build writes into `build/`, and its `package.json`, `scripts/` and `node_modules/` stay behind, as `site-plugins/` does.
