---
status: accepted
date: 2026-11-04
---

# Shared styles come from a private GitHub package installed through `NPM_RC`

The block's fallback in WordPress and the `<RelatedResources>` component here show the same thing, so they share one set of styles: `tokens.css`, `related.css` and `card.css` in `@colbitron/resource-hub-ui`, which lives in the WordPress repository at `packages/ui/` and is published to GitHub Packages as a private package by a `ui-v*` tag (WordPress side, ADR 0028). This app pins an exact version and imports the CSS from the component that uses it, never from `layout.tsx`, so pages without the component do not load it. The class names (`.rh-related`, `.rh-card…`) and tokens are part of the contract.

The package is private because it is the internal contract of two repositories, not a library: the owner prefers it not be discoverable as a general-use package, which a public listing on npmjs would invite whatever its README said.

Vercel installs from GitHub's registry through an `NPM_RC` environment variable; `NPM_TOKEN` alone covers only npmjs. `NPM_RC` holds a `registry=https://registry.npmjs.org` line, a `@colbitron` scope line for `npm.pkg.github.com`, and a classic personal access token with `read:packages` only and an expiry. This repository's Actions use `GITHUB_TOKEN` once the package grants it access under "Manage Actions access".

## Considered options

- **A public package on npmjs.** Needs no token. Rejected as the default because it would list an internal contract as a general-use package. It is the fallback only: Vercel does not document pnpm with `NPM_RC`, so this starts with a spike (publish 0.0.1 with `tokens.css`, deploy a preview that imports it), and only if the spike fails does the package go public on npmjs, marked internal and unsupported.

## Consequences

- `NPM_RC` is a secret in Vercel project settings, never in git; the token expires and has to be rotated.
- Local installs need the same scope line and a token in the developer's own `~/.npmrc`.
- A class-name change is a new package version and a contract change, made in both repositories in the same sitting.
