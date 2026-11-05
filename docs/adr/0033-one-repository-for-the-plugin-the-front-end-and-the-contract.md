---
status: accepted
date: 2026-11-04
---

# One repository holds the plugin, the front end and the contract package

The demo began as two repositories, `resource-hub-wp` for the plugin and `resource-hub-next` for the Next.js front end, with this one's root being the plugin directory itself ([ADR 0002](0002-repository-root-is-the-plugin.md)). The contract between them then became a package, `@colbitron/resource-hub-ui` under `packages/ui/`, holding the JSON Schemas both sides check themselves against ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)) and the stylesheet both render with ([ADR 0028](0028-shared-styles-in-a-private-github-package.md)). Every real change to that package is a change to both consumers in the same sitting: a new event shape needs the PHP that builds it, the Zod that parses it, and the fixtures that prove both, and a renamed class needs the block's markup and the component's. Two repositories make that one change into two or three pull requests that have to land in order, with a package publish between them, and a reviewer who reads the diff one side at a time.

The repository is now a pnpm workspace that holds all three. The plugin lives at `wp-content/plugins/resource-hub-wp/`, the path WordPress loads it from, with the same directory name as before so wp-env's plugin slug and the host's deploy target do not change. The front end lives at `apps/web/`, imported with its commit history so `git log` under that path still shows the front end's own decisions. The package stays at `packages/ui/`, and when the front end starts consuming its schemas and styles it takes them as a workspace link (`workspace:*`) rather than a published version, so a contract change is one pull request whose diff shows the schema, both consumers and every test together, and the publish step exists only for a future consumer outside this repository.

## Considered options

- **Two repositories and a published package**, the status quo plus ADR 0028's private GitHub package. Rejected: each contract change becomes an ordered sequence of pull requests with a publish in the middle, and the review that matters, the one that reads both sides of a change at once, has no single diff to read.
- **Git submodules or subtrees that mirror the package into the front end.** Rejected: a mirror has a version to bump and can lag, which is the drift the package exists to prevent.
- **A third repository for the package alone.** Rejected in ADR 0010 already: more process than seven files warrant, and it still leaves the two consumers' changes in separate pull requests.

## Consequences

- The repository root is a private workspace package, not the plugin. `pnpm-workspace.yaml` lists `wp-content/plugins/*`, `apps/*` and `packages/*`; one lockfile covers them all. The wp-env scripts stay at the root, where `.wp-env.json` is, and mount the plugin from its new path; `pnpm build`, `pnpm lint:js`, `pnpm test:e2e` and the `web:*` scripts delegate with `pnpm --filter`.
- The plugin is still self-contained for PHP: its `composer.json`, PHPCS and PHPUnit configuration and `tests/phpunit/` move with it, and the deploy job runs `composer install --no-dev` and the rsync from the plugin directory, so the allowlist and the host layout still match one to one and nothing else in the workspace can reach the host.
- The front end keeps its own ESLint configuration, TypeScript configuration and scripts; wp-scripts lints the plugin with the WordPress presets from the plugin directory. Nothing at the root is shared between the two, by design, so neither set of rules leaks into the other.
- CI gains a `web` job that lints, typechecks and builds the front end on every pull request and push to `main`. The CMS deploy waits for the CMS gate only, so a front-end failure cannot block a CMS deploy or a rollback; the front end's production deploy, added in slice 3, waits for both the CMS deploy and the `web` job.
- The front end's own ADRs arrive numbered from 0001 under `apps/web/docs/adr/` and overlap with this directory's numbering; renumbering them, merging the two `CLAUDE.md` files and revisiting ADR 0028 (the package is now a workspace link, and publishing is only for an outside consumer) are documentation work that follows this change rather than being mixed into it. Done: the front end's records are ADRs 0034–0040, and [ADR 0041](0041-the-shared-package-is-a-workspace-dependency.md) replaces ADR 0028.
- `wp-content/themes/` is absent until the CMS theme arrives; the layout leaves room for it beside the plugin.
