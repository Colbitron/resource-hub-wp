---
status: accepted
date: 2026-11-03
amended: [2026-11-07, 2026-11-08]
---

# The CMS runs on Cloudways (DigitalOcean 2 GB) so the front end can reach it

The Next.js front end on Vercel reads this site over REST and receives revalidation requests from it, so WordPress must be reachable over public HTTPS. wp-env runs on a laptop and is not, and a tunnel to it would make the whole system depend on one machine being awake. A hosted WordPress also exercises the behaviour that matters most, outbound HTTP from a save hook to a remote front end, for real rather than against localhost.

Four hosts were compared on the same checklist: PHP version parity with wp-env, a persistent object cache, SSH and WP-CLI, a deploy path from GitHub Actions, HTTPS on a public URL, and setup time.

## Considered options

- **Pantheon (free Sandbox).** PHP 8.5, Redis, a git pipeline, a read-only codebase on Test and Live. Rejected: non-Live containers spin down after about an hour idle and take up to 30 seconds to wake, and deploying means syncing the plugin into a second repository that also holds core.
- **WordPress.com Business.** The cleanest deploy, but roughly twice the price, PHP 8.5 unconfirmed, and no direct control of `wp-config.php`.
- **A bare DigitalOcean droplet.** Any PHP version and full control, at the cost of owning the web server, TLS renewal, updates and backups.
- **Cloudways Flexible on a DigitalOcean 2 GB server.** About 11 USD a month, hourly billing. SSH, SFTP and WP-CLI; Redis with Object Cache Pro; `wp-config.php` and outbound HTTP in our hands; a server that stays warm. PHP tops out at 8.4. Chosen: the control of a server with the operations of a managed host, and the one thing it lacks costs a minor-version pin.

## Consequences

- **PHP is pinned to 8.4 everywhere**: `.wp-env.json`, CI and the host run the same minor version. The plugin's declared floor stays at 8.2 and is no longer exercised by CI.
- **HTTPS and the public URL come from a hostname the owner controls**, with a Let's Encrypt certificate; `home` and `siteurl` are set to it, which makes it the `rest_url` base the front end sees.
- **Deployment is a CI job, not a manual upload**, by rsync over SSH from the plugin directory into the same path on the host, so the plugin basename is the same in every environment. How it runs, rolls back and what feeds it is in [`docs/runbooks/deploy.md`](../runbooks/deploy.md).
- **Configuration uses the constants path**: the plugin's settings are `define()`d in the host's `wp-config.php`, with the settings page as the fallback for hosts where that file is not editable.
- **The no-filesystem-writes rule is ours to keep.** The host does not enforce a read-only codebase, so the rule is held by review and by PHPCS.
- **The object cache is real on the host and only there.** wp-env has no persistent object cache, so PHPUnit cannot exercise persistence or invalidation; those get checked against the host.

## Amendments

### 2026-11-07

The plugin's declared PHP floor is raised from 8.2 to 8.4, to match the pin: `Requires PHP` in `resource-hub.php`, `"php"` in the plugin's `composer.json` (with the lock's content hash) and PHPCS `testVersion`. The Consequences above said the floor stayed at 8.2 and was not exercised by CI. It could not be: the locked dev toolchain already needed 8.4 (`doctrine/instantiator` 2.1.0, which PHPUnit 9.6 pulls in, requires `php ^8.4`), so `composer install` refused to run on 8.2 and nothing could test it there. The host, wp-env and CI all run 8.4, so the floor now names the one version the plugin is tested on.

### 2026-11-08: the deploy also syncs Relevanssi and the CMS theme

**What changed.** The deploy's rsync over SSH now runs three syncs, not one, so "by rsync over SSH from the plugin directory into the same path on the host" under Consequences no longer describes the whole deploy. In order:

- **Relevanssi** (pull request #124; ADR 0033, amended 2026-11-08), installed by the Composer project in `site-plugins/` into `wp-content/plugins/relevanssi/` and checked file by file against WordPress.org's published SHA-256 for its version, then sent whole from that directory into the same path on the host. It takes no allowlist, because the directory is the release as published, with nothing development-only to leave behind; `site-plugins/` itself stays behind.
- **The plugin**, from its directory into the same path on the host, as before, with its allowlist.
- **The CMS theme** (pull request #137; ADR 0033, amended 2026-11-08), an allowlist sync from `wp-content/themes/resource-hub/` into the same path on the host, followed by its activation and an anonymous request for a theme page that must get the theme's 404.

Each sync's `--delete` is scoped to its own target, a fixed path under the WordPress root that the deploy checks, so it can remove nothing outside that one directory. How each runs and fails is in [`docs/runbooks/deploy.md`](../runbooks/deploy.md).

**What did not.** The decision is unchanged: the CMS runs on Cloudways, and a CI job deploys it by rsync over SSH, the plugin still into the same path on the host, so the plugin basename is the same in every environment. The CMS deploy still runs before the front end's (ADR 0051).
