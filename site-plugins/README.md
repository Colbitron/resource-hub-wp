# Third-party WordPress plugins

The plugins the CMS runs beside its own, as a Composer project: today one, [Relevanssi](https://wordpress.org/plugins/relevanssi/) (the free version), the search engine behind the plugin's search (issue #115). Each comes from [wpackagist](https://wpackagist.org), the Composer mirror of the wordpress.org directory, pinned to an exact version in `composer.json` and to its archive in `composer.lock`, and `composer/installers` puts it in `../wp-content/plugins/{name}/`. Neither that directory nor this one's `vendor/` is committed (`.gitignore`).

**Why its own directory.** Relevanssi belongs to the site, not to the `resource-hub` plugin, whose `composer.json` and production `vendor/` ship only the plugin itself; a root `composer.json` would need the whole repository mapped into the wp-env containers, where Apache would serve it, `.env` files included, so this small directory is mapped instead (`.wp-env.json`), and its `../wp-content/plugins/` lands on the same directory in the containers, on a laptop and on the deploy runner.

## How it is installed

- **wp-env.** `.wp-env.json` maps this directory and the repository's `wp-content/plugins/` into both containers, and its `afterStart` script runs `composer install` here on every start, then activates Relevanssi on both sites and builds the search index. It cannot be a wp-env `plugins` entry: wp-env activates those before `afterStart`, when a fresh checkout has no Relevanssi yet. The whole `plugins` directory is mapped, not Relevanssi's alone, because Composer replaces a package by deleting its directory, which fails on a mount point and leaves the plugin empty.
- **CI.** The gate needs nothing extra: `pnpm env:start` installs it, from a fresh checkout every run, so a restored wp-env cache cannot hold a stale copy.
- **The deploy.** The `deploy` job in `.depot/workflows/ci.yml` runs `composer install --no-dev` here on the runner, checks the installed version against the lock, rsyncs `wp-content/plugins/relevanssi/` into the same directory on the host, activates it and rebuilds the index (`docs/runbooks/deploy.md`, "The CMS deploy").

Relevanssi's settings are not set here or in its settings screen: the plugin answers them in code (`wp-content/plugins/resource-hub-wp/src/Search/RelevanssiConfig.php`).

## Changing a version

From the repository root, with wp-env running:

```sh
# Edit the exact version in composer.json, then:
pnpm composer:site update wpackagist-plugin/relevanssi
pnpm wp resource-hub search-index
```

Commit `composer.json` and `composer.lock` together. Read the plugin's changelog first, check its `Requires PHP` and `Requires at least` against the host (PHP 8.4), and run the plugin's gate: `pnpm test:php` runs the search tests against the version installed. Relevanssi 4.28.8 declares `Requires PHP: 7.1` and `Requires at least: 4.9`, in its `readme.txt`. A release that changes Relevanssi's database version upgrades its tables on the first admin page load after the deploy, not from WP-CLI, so load one before relying on search.

Adding a plugin is the same: `pnpm composer:site require wpackagist-plugin/<slug>:<exact version>`, then an activation step for it in `.wp-env.json` and in the deploy job, each with its own exact target directory.
