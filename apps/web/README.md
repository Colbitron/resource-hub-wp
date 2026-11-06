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
pnpm web:test        # vitest run (unit tests, *.test.ts)
pnpm web:test:e2e    # playwright test (end to end, e2e/*.spec.ts, against the mock CMS in e2e/mock-cms/)
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `WP_API_URL` | Base URL of the CMS's REST API, ending in `/wp-json`, with no query, fragment or credentials. Locally, wp-env serves it at `http://localhost:8888/wp-json`. |
| `REVALIDATE_SECRET` | Shared secret the CMS sends as a bearer token to `POST /api/revalidate/`. |
| `WP_MEDIA_ORIGIN` | Optional. The site base `/media/…` is rewritten under, as `{base}/wp-content/uploads/…`: an origin, optionally with the path WordPress is installed in (`https://example.com/blog`). Defaults to `WP_API_URL` without `/wp-json`. |
| `SITE_URL` | The site's public origin (`https://resources.example`): `https:`, or `http:` only for localhost, with no path, query, fragment or credentials. The root layout sets it as `metadataBase`, so every page's canonical link, `og:url` and `og:image` are absolute on the public domain. Optional locally, where they stay relative; a Vercel build fails without it. |

All are server-only, read and validated in `lib/env.ts` when first used, never `NEXT_PUBLIC_`. `next.config.ts` reads `WP_API_URL` and `WP_MEDIA_ORIGIN` for the `/media/` rewrite: with neither set, a Vercel build fails and a local or CI build leaves the rewrite out with a warning. Vercel builds are recognised by the `VERCEL` system variable, which is only present when the project exposes system environment variables to builds (a project setting, "Automatically expose System Environment Variables"); keep it on, or a Vercel build without a base deploys with every `/media/` image a 404. `next.config.ts` also checks `SITE_URL`: a malformed value fails every build, and on Vercel an unset one fails the build too, so no deploy publishes a relative canonical. Set `WP_API_URL` and `SITE_URL` for both the Production and the Preview environments, because Preview builds fail without them; on Preview, `SITE_URL` is the production origin, so a preview's canonical points at the public page rather than at the preview. They live in `.env.local` (gitignored) and in Vercel project settings, never in git.

## Routes

- `/resources/`, `/resources/[type]/`, `/resources/topic/[topic]/` and `/resources/[type]/topic/[topic]/`, each paginated as `…/page/[n]/`: the listings, ISR routes rendered on their first request (ADR 0050), with a filter bar, a card grid and pagination from `components/ListingPage.tsx`. A mixed-case segment or a trailing `/page/1/` is redirected to the canonical URL by `proxy.ts` with a single-hop 308 and `Cache-Control: no-store` (ADR 0035).
- `/resources/[type]/[slug]/`: the single resource, in a later pull request.
- `/` and `/[page]/…/`: the CMS's static front page and every other published WordPress page at its parent chain, from the root catch-all `app/[[...path]]/page.tsx`, rendered on every request with the Data Cache behind it; a welcome page at `/` when no front page is set (ADR 0052).
- `POST /api/revalidate/`: the on-demand revalidation route (ADR 0048).

## Status

The listings, the data layer and the revalidation route are in; the single-resource page is next. CI lints, typechecks, builds and runs the unit and end-to-end tests.
