---
status: accepted
date: 2026-11-04
---

# The shared package is a workspace dependency and is never published

`@colbitron/resource-hub-ui` at `packages/ui/` holds the contract's JSON Schemas ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)) and is where the stylesheet the block and the front end share will live. While the front end lived in a repository of its own, it could reach the package only through a registry, so [ADR 0028](0028-shared-styles-in-a-private-github-package.md) published it privately to GitHub Packages and [ADR 0038](0038-shared-styles-through-npm-rc.md) had Vercel install it through an environment variable holding a classic token, after a spike to prove pnpm worked that way. Since [ADR 0033](0033-one-repository-for-the-plugin-the-front-end-and-the-contract.md) the CMS, the front end and the package live in one repository and one pnpm workspace, and every consumer is inside it.

The package is consumed through the workspace and never published. Each consumer takes it that way from its first import: the front end declares `"@colbitron/resource-hub-ui": "workspace:*"` and gets a link to `packages/ui/` when it first imports the schemas, in slice 3, and the plugin's block and the CMS theme build their CSS from the same source when the shared stylesheet lands, in slice 5. Today the package holds the schemas, their fixtures and their test, and no consumer imports it yet. `packages/ui/package.json` is marked `"private": true` and has no `publishConfig`. There is no publish workflow, no registry token, no `.npmrc` scope line and no install variable on Vercel. This supersedes ADR 0028 and ADR 0038, and narrows ADR 0033, which left publishing open for a future outside consumer.

## Considered options

- **Keep publishing to GitHub Packages for a future outside consumer.** What ADR 0033 left open. Rejected: no such consumer exists, and a publish path nothing exercises is a token to rotate and a workflow to keep working for no reader. If an outside consumer appears, publishing is a new decision.
- **A public package on npmjs.** Rejected for the reason ADR 0028 gave: the owner does not want an internal contract discoverable as a general-use package, and with every consumer in the workspace it would buy nothing.

## Consequences

- A contract change (schema, fixtures, the PHP that builds a payload, the Zod that parses it, a class name) is one pull request. There is no version to bump or pin, and both consumers always build against the same commit of the package.
- `"private": true` makes `pnpm publish` and `npm publish` refuse, so an accidental publish fails instead of leaking the package.
- Vercel builds the front end from this repository with its Root Directory set to `apps/web` and installs the workspace from the checkout, so the link needs no registry access. That is checked when the front end is first deployed, in slice 3.
- The spike, the `ui-v*` tag workflow, the package quotas and the expiring token in ADRs 0028 and 0038 no longer apply. Their other choices stand: the class names and tokens are part of the contract, each side loads the CSS only where it is used, there is no shared JavaScript, and the deploy's rsync allowlist keeps `packages/` off the host, so once the plugin builds its CSS from the package (slice 5) that CSS reaches WordPress through the plugin's `build/`.
- The CMS theme planned for slice 5 (`wp-content/themes/resource-hub/`) takes the same tokens and CSS through the workspace.
