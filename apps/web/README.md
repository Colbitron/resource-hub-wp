# Resource Hub: Next.js front end

The front end of Resource Hub: a Next.js 16 App Router app in TypeScript that renders the resources library and the CMS's pages from the WordPress REST API and rebuilds pages on demand when the CMS says so. It is a demonstration of a pattern, written fresh, not production code.

The project's [README](../../README.md) has the architecture and the layout; the contract is in [`packages/ui/README.md`](../../packages/ui/README.md); how caching and redirects work is in [`docs/architecture/caching.md`](../../docs/architecture/caching.md); [`CLAUDE.md`](CLAUDE.md) here has the rules for every edit in this app.

## Running it

Requires Node 24 and pnpm (the version is pinned in the root `package.json`). From the repository root:

```bash
pnpm install                                # the whole workspace
cp apps/web/.env.example apps/web/.env.local # fill in WP_API_URL and REVALIDATE_SECRET
pnpm web:dev                                # http://localhost:3000
```

Checks, from the root (or `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` and `pnpm build` in this directory):

```bash
pnpm web:typecheck   # next typegen && tsc --noEmit
pnpm web:lint        # eslint
pnpm web:test        # vitest run (unit tests, test/*.test.ts and lib/*.test.ts)
pnpm web:test:e2e    # playwright test (e2e/*.spec.ts, against the mock CMS in e2e/mock-cms/)
pnpm web:build       # next build
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `WP_API_URL` | Base URL of the CMS's REST API, ending in `/wp-json`, with no query, fragment or credentials. Locally, wp-env serves it at `http://localhost:8888/wp-json`. |
| `REVALIDATE_SECRET` | Shared secret the CMS sends as a bearer token to `POST /api/revalidate/`. It must meet [the secret's rule](../../packages/ui/README.md#configuration) in the contract. |
| `WP_MEDIA_ORIGIN` | Optional. The site base `/media/…` is rewritten under, as `{base}/wp-content/uploads/…`: an origin, optionally with the path WordPress is installed in (`https://example.com/blog`). Defaults to `WP_API_URL` without `/wp-json`. |
| `SITE_URL` | The site's public origin (`https://resources.example`): `https:`, or `http:` only for localhost, with no path, query, fragment or credentials, and never the CMS's origin. The root layout sets it as `metadataBase`, so every page's canonical link, `og:url` and `og:image` are absolute on the public domain. Optional locally, where they stay relative; a Vercel build fails without it. |

All are server-only, read and validated in `lib/env.ts` when first used, never `NEXT_PUBLIC_`. `next.config.ts` reads `WP_API_URL` and `WP_MEDIA_ORIGIN` for the `/media/` rewrite (`lib/media-rewrites.ts`): with neither set, a Vercel build fails and a local or CI build leaves the rewrite out with a warning. Vercel builds are recognised by the `VERCEL` system variable, which is only present when the project exposes system environment variables to builds (a project setting, "Automatically expose System Environment Variables"); keep it on, or a Vercel build without a base deploys with every `/media/` image a 404. `next.config.ts` also checks `SITE_URL`: a malformed value fails every build, and on Vercel an unset one fails the build too. Set `WP_API_URL` and `SITE_URL` for both the Production and the Preview environments, because Preview builds fail without them; on Preview, `SITE_URL` is the production origin, so a preview's canonical points at the public page. They live in `.env.local` (gitignored) and in Vercel project settings, never in git.

## Routes

Every route is ISR, rendered on its first request and stored until a revalidation event or the hourly interval clears it; the build renders nothing from the CMS.

- `/resources/`, `/resources/[type]/`, `/resources/topic/[topic]/` and `/resources/[type]/topic/[topic]/`, each paginated as `…/page/[n]/`: the listings, thin shells over `components/ListingPage.tsx` with a filter bar, a card grid and pagination. A listing answers an unknown term or a page past the end with a stored 404 and never redirects. An old topic URL is a 404 after a re-slug; there is no topic redirect.
- `/resources/[type]/[slug]/`: the single resource (`components/ResourceArticle.tsx`), with its body through the one-pass renderer in `lib/content/render.tsx`. The slug is the identity: a wrong type segment, or an old slug found through the CMS's resolve route, gets one computed 308 to the canonical URL, stored and cleared by the resource's own events (`lib/redirects.ts`).
- `/` and `/[page]/…/`: the CMS's static front page and every other published WordPress page at its parent chain, from the root catch-all `app/[[...path]]/page.tsx` (`lib/page-request.ts`, `components/PageArticle.tsx`); a welcome page at `/` when no front page is set. A first segment the app's own routes use (`resources`, `api`, `media`, `_next`) is a 404 without a request.
- A mixed-case or otherwise non-canonical path, and a trailing `/page/1/`, is redirected by `proxy.ts` with a single-hop 308 and `Cache-Control: no-store` before any route runs (`lib/canonical-path.ts`).
- `POST /api/revalidate/`: the on-demand revalidation route (`app/api/revalidate/route.ts`).

## Images

Images are served through the same-origin `/media/…` rewrite and rendered with `next/image` through Vercel's image optimizer, which resizes them per device and serves modern formats; the CMS host is never in `images.remotePatterns`, and `images.localPatterns` allows `/media/**` with no query string, so no one can vary the URL to spend the optimiser's allowance. Every CMS image renders with a width and a height inside a fixed-aspect box, so a late image moves nothing. The owner's Vercel plan includes 5,000 optimized images a month, which is the number to watch; the fallback if that ever becomes a problem is proxying the originals and WordPress's generated sizes through Cloudflare with no transformations. An image in a body on another host stays a plain lazy `<img>`; an image that names the CMS host but is not an upload is dropped (`lib/content/render.tsx`).

## Status

The listings, the single resource, the CMS's pages, the data layer, the content renderer and the revalidation route are in, all ISR. The related section that swaps the block marker for a `<RelatedResources>` component is slice 4 ([issue #50](https://github.com/Colbitron/resource-hub-wp/issues/50)). CI lints, typechecks, builds and runs the unit and end-to-end tests.

## Possible next steps

Only once the core is green, in this order:

1. A GraphQL data path beside REST, once the plugin adds WPGraphQL, with a short written comparison.
2. Draft preview through the signed token from the plugin.
3. Lighthouse CI budgets and an axe check inside the Playwright run, so the pipeline produces the numbers.
