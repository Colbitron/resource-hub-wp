---
status: superseded by 0033
date: 2026-11-03
---

# The repository root is the plugin directory

The obvious layout for a WordPress project is a `wp-content/plugins/resource-hub/` tree inside a site checkout. This repository contains one plugin and nothing else, so the plugin's main file, `src/`, `composer.json`, and the test suites sit at the root, and `.wp-env.json` mounts `.` as a plugin. One mount serves wp-env, Composer's autoloader, PHPCS, PHPUnit, and CI with no path indirection.

## Consequences

- The plugin slug inside WordPress is the directory name, `resource-hub-wp`, not `resource-hub`. The slug is only visible in the plugins list and in e2e selectors.
- Block JavaScript lives in `blocks/`, not `src/`, so the PSR-4 root holds only PHP.
