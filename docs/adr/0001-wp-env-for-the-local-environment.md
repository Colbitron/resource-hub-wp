---
status: accepted
date: 2026-11-03
---

# wp-env on Docker is the only local environment

The plugin needs a WordPress to run in, locally and in CI, and the PHPUnit suite needs the WordPress core test library wired to a database. LocalWP is the usual choice for a developer machine but doesn't work great with CI, so using it would mean maintaining a second environment and a second test setup for GitHub Actions and keeping them in step. We use `@wordpress/env` alone: `.wp-env.json` is committed, the same `wp-env` commands run the suite on a laptop and on a runner, and the container is the source of truth for every result.

## Consequences

- Docker must be running before any PHP tooling works. There is no host PHP, Composer, or WP-CLI; `package.json` wraps the container commands.
- wp-env's tests site is reinstalled by every PHPUnit run, which deactivates plugins there. Playwright specs activate the plugin themselves (see the README's testing section).
