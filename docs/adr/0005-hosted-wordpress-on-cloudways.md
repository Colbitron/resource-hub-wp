---
status: accepted
date: 2026-11-03
---

# The CMS runs on Cloudways (DigitalOcean 2 GB) so the front end can reach it

The Next.js front end on Vercel reads this site over REST and receives revalidation requests from it, so WordPress must be reachable over public HTTPS. wp-env ([ADR 0001](0001-wp-env-for-the-local-environment.md)) runs on a laptop and is not, and a tunnel to it would make the whole system depend on one machine being awake. A hosted WordPress is also closer to how this plugin would actually run, so the behaviour that matters most, outbound HTTP from a save hook to a remote front end, is exercised for real rather than against localhost.

We considered four hosts against the same checklist: PHP version parity with wp-env, a persistent object cache, SSH and WP-CLI, a deploy path from GitHub Actions, HTTPS on a public URL, and setup time.

- **Pantheon (free Sandbox).** PHP 8.5, Redis on sandbox sites, git pipeline, HTTPS on `pantheonsite.io`, and a read-only codebase on Test and Live. Rejected for two operational reasons: non-Live containers [spin down after about an hour idle](https://docs.pantheon.io/application-containers) and take up to 30 seconds to wake on the next request, and deploying means syncing this plugin into a second git repository that also holds WordPress core.
- **WordPress.com Business.** The cleanest deploy (GitHub Deployments targets a plugin directory directly) but roughly twice the price, PHP 8.5 availability unconfirmed, and no direct control of `wp-config.php`.
- **A bare DigitalOcean droplet.** Any PHP version and full control, but we would own the web server, TLS renewal, updates, and backups.
- **Cloudways Flexible on a DigitalOcean 2 GB server.** About 11 USD a month at the time of writing, hourly billing. SSH, SFTP, and WP-CLI; Redis with Object Cache Pro installed on the WordPress application; `wp-config.php` and outbound HTTP fully in our hands; a server that stays warm. PHP tops out at 8.4.

We use Cloudways. It gives the control of a server with the operations of a managed host, and the one thing it lacks, PHP 8.5, costs a minor-version pin rather than a workaround.

## Consequences

- **PHP is pinned to 8.4 everywhere.** `.wp-env.json` moves from 8.5 to 8.4 so the laptop, CI, and the host run the same minor version. The plugin's declared floor stays at 8.2 (`Requires PHP`, `composer.json`, PHPCS `testVersion`) but is no longer exercised by CI; a non-blocking matrix leg can restore that if it matters.
- **HTTPS and the public URL come from our own hostname.** A subdomain we control points at the server and carries a Let's Encrypt certificate, so the site's address does not depend on the host's generated app URL. WordPress's `home` and `siteurl` are set to that hostname, which makes it the `rest_url` base the front end sees and the one in the revalidation payload.
- **Deployment will be a CI job, not a manual upload.** The job runs on `main` after the gate passes, from a fresh checkout: build the block, `composer install --no-dev`, then `rsync --delay-updates` with an exclude list over SSH into `wp-content/plugins/resource-hub-wp`, the same directory name wp-env uses ([ADR 0002](0002-repository-root-is-the-plugin.md)), so the plugin basename is identical in every environment. It gets its own concurrency group with `cancel-in-progress: false` so a second merge cannot interrupt a sync, and it ends with a smoke request to the REST root. Rolling back is redeploying an earlier ref by `workflow_dispatch`. Five secrets feed it: the dedicated deploy key, the SSH host, user, remote path, and the pinned host key, so the runner never trusts on first use.
- **The deploy-from-main rule is enforced by the workflow trigger, not yet by the platform.** The repository is private on a free plan, which offers neither environments nor branch rulesets, so a pull request that edited the workflow could reach the repository secrets. The only collaborator is the owner, so this is accepted for now; when the repository goes public, the deploy secrets move to a `production` environment limited to `main` and a ruleset requires the gate on `main`.
- **Configuration uses the constants path.** `RESOURCE_HUB_FRONTEND_URL` and `RESOURCE_HUB_REVALIDATE_SECRET` are `define()`d in the host's `wp-config.php`. The settings page planned in CLAUDE.md remains the fallback for hosts where that file is not editable.
- **The no-filesystem-writes rule is ours to keep.** Unlike Pantheon, the host does not enforce a read-only codebase, so the rule is held by review, with PHPCS catching the common write functions.
- **The object cache will be real on the host, and only there.** Redis means the related-query cache in the custom REST route will persist across requests, which is what the cache strategy ADR will assume. wp-env has no persistent object cache, so PHPUnit cannot exercise persistence or invalidation; those get checked against the host.
