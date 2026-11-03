---
status: accepted
date: 2026-11-03
---

# The CMS runs on Cloudways (DigitalOcean 2 GB) so the front end can reach it

The Next.js front end on Vercel reads this site over REST and receives revalidation requests from it, so WordPress must be reachable over public HTTPS. wp-env ([ADR 0001](0001-wp-env-for-the-local-environment.md)) runs on a laptop and is not, and a tunnel to it would make the whole system depend on one machine being awake. A hosted WordPress is also closer to how this plugin would actually run, so the behaviour that matters most, outbound HTTP from a save hook to a remote front end, is exercised for real rather than against localhost.

We considered four hosts against the same checklist: PHP version parity with wp-env, a persistent object cache, SSH and WP-CLI, a deploy path from GitHub Actions, HTTPS on a public URL, and setup time.

- **Pantheon (free Sandbox).** PHP 8.5, Redis on sandbox sites, git pipeline, HTTPS on `pantheonsite.io`, and a read-only Test/Live filesystem. Rejected for two operational reasons: idle sandboxes sleep and wake slowly, and the deploy means syncing this plugin into a second repository that also holds core.
- **WordPress.com Business.** The cleanest deploy (GitHub Deployments targets a plugin directory directly) but roughly twice the price, PHP 8.5 availability unconfirmed, and no direct control of `wp-config.php`.
- **A bare DigitalOcean droplet.** Any PHP version and full control, but we would own the web server, TLS renewal, updates, and backups.
- **Cloudways Flexible on a DigitalOcean 2 GB server.** About 11 USD a month, hourly billing. SSH, SFTP, and WP-CLI; Redis enabled by default with an object-cache drop-in; `wp-config.php` and outbound HTTP fully in our hands; a server that stays warm. PHP tops out at 8.4.

We use Cloudways. It gives the control of a server with the operations of a managed host, and the one thing it lacks, PHP 8.5, costs a minor-version pin rather than a workaround.

## Consequences

- **PHP is pinned to 8.4 everywhere.** `.wp-env.json` moves from 8.5 to 8.4 so the laptop, CI, and the host run the same minor version. The plugin's own floor stays at 8.2 (`Requires PHP`, `composer.json`, PHPCS `testVersion`).
- **HTTPS comes from our own hostname.** Cloudways' temporary app URL is not guaranteed a certificate, so a subdomain we control points at the server and gets a Let's Encrypt certificate. That hostname is the `rest_url` base the front end sees and the one in the revalidation payload.
- **Deployment is a CI step, not a manual upload.** A job on `main` runs after the gate passes, builds the block and installs Composer dependencies without dev packages, and `rsync`s the plugin over SSH to `wp-content/plugins/resource-hub`. The SSH key and host live in GitHub Actions secrets. Branches and pull requests never deploy.
- **Configuration uses the constants path.** `RESOURCE_HUB_FRONTEND_URL` and `RESOURCE_HUB_REVALIDATE_SECRET` are `define()`d in the host's `wp-config.php`; the settings-page fallback exists for hosts where that file is not editable.
- **The no-filesystem-writes rule is ours to keep.** Unlike Pantheon, the host does not enforce a read-only codebase, so the rule is held by review and PHPCS rather than by the platform.
- **The object cache is real.** Redis on the host means the related-query cache in the custom REST route persists across requests, which is the behaviour the cache strategy ADR will assume.
