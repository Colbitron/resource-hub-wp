# Resource Hub: Next.js front end

The front end of Resource Hub: a Next.js 16 App Router app in TypeScript that will render the resources library from the WordPress REST API and rebuild pages on demand when the CMS says so. It is a demonstration of a pattern, written fresh, not production code.

The project's [README](../../README.md) has the architecture, the layout of the repository, the contract with the CMS and the decision records ([`docs/adr/`](../../docs/adr/)); [`CLAUDE.md`](CLAUDE.md) here has what is specific to this app.

## Running it

Requires Node 24 and pnpm (the version is pinned in the root `package.json`). From the repository root:

```bash
pnpm install                                # the whole workspace
cp apps/web/.env.example apps/web/.env.local # fill in WP_API_URL and REVALIDATE_SECRET
pnpm web:dev                                # http://localhost:3000
```

Checks, from the root (or `pnpm typecheck`, `pnpm lint` and `pnpm build` in this directory):

```bash
pnpm web:typecheck   # next typegen && tsc --noEmit
pnpm web:lint        # eslint
pnpm web:build       # next build
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `WP_API_URL` | Base URL of the CMS's REST API (`/wp-json`). Locally, wp-env serves it at `http://localhost:8888/wp-json`. |
| `REVALIDATE_SECRET` | Shared secret the CMS sends as a bearer token to `POST /api/revalidate`. |

Both live in `.env.local` (gitignored) and in Vercel project settings, never in git.

## Status

Scaffold only. The resources pages, data layer, revalidation route and tests are coming in later pull requests; CI already lints, typechecks and builds it.
