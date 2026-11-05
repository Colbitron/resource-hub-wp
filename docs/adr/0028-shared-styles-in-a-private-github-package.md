---
status: accepted
date: 2026-11-04
---

# The block's styles are shared with the front end through a private GitHub package

The block's fallback list ([ADR 0026](0026-block-renders-a-marker-with-a-fallback.md)) and the front end's `<RelatedResources>` component show the same thing in two places, so they should look the same from one source. One stylesheet set, `tokens.css`, `related.css` and `card.css`, is shared between WordPress and Next.js. It lives in `@colbitron/resource-hub-ui` at `packages/ui/`, the pnpm workspace package that also holds the contract schemas ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)), and is published as a private package on GitHub Packages. It is private because it is the internal contract of two repositories, not a library: the owner prefers it not be discoverable as a general-use package, which a public listing on npmjs would invite whatever its README said. The class names (`.rh-related`, `.rh-card…`) and the tokens in `tokens.css` become part of the contract. There is no shared JavaScript.

Each side loads the styles only where they are needed. WordPress builds from the workspace source and never needs a token, attaching the CSS through `block.json`'s `style` or `viewStyle`. The front end imports it from the component that uses it, never from `layout.tsx`.

## Publishing and installing

Pushing a `ui-v*` tag publishes the package with `GITHUB_TOKEN` and `packages: write`, and the front end pins an exact version. Vercel installs it through an `NPM_RC` environment variable, which Vercel documents for GitHub's registry (`NPM_TOKEN` alone covers only npmjs): it holds a `registry=https://registry.npmjs.org` line, a `@colbitron` scope line pointing at `npm.pkg.github.com`, and a classic personal access token with `read:packages` only and an expiry. The front end's Actions use `GITHUB_TOKEN` after a "Manage Actions access" grant on the package.

Vercel does not document pnpm with `NPM_RC`, so this starts with a spike: publish 0.0.1 with `tokens.css` and deploy a preview that imports it. If the spike fails, the owner decides the delivery route again; there is no automatic fallback to a public package.

## Considered options

- **A public package on npmjs.** No token anywhere, and Vercel's documented path. Rejected by the owner: a public listing makes an internal contract discoverable as if it were a general-use package.
- **Copying the files into the front end by path.** Rejected: two copies drift, which is what the package exists to prevent ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)).

## Consequences

- Free-plan quotas apply: 500 MB of package storage, shared with Actions artifacts, and 1 GB of transfer a month. Actions downloads with `GITHUB_TOKEN` do not count, and with no payment method GitHub blocks rather than bills.
- The deploy rsync allowlist keeps `packages/` off the host; the built CSS reaches WordPress through `build/`.
- A class-name change is a contract change and a new package version, read by both sides in the same sitting.
- The classic token is a secret with an expiry, held in Vercel project settings, never in git.
