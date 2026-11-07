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
pnpm web:test:e2e    # playwright test (e2e/*.spec.ts, against the mock CMS in e2e/mock-cms/), axe included
pnpm web:test:screenshots         # the design specimen against its pixel baselines, in Docker
pnpm web:test:screenshots:update  # rewrite the baselines after a design change
pnpm web:test:lighthouse          # Lighthouse CI on the sampled URLs, mobile budgets
pnpm web:build       # next build
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `WP_API_URL` | Base URL of the CMS's REST API, ending in `/wp-json`, with no query, fragment or credentials. Locally, wp-env serves it at `http://localhost:8888/wp-json`. |
| `REVALIDATE_SECRET` | Shared secret the CMS sends as a bearer token to `POST /api/revalidate/`. It must meet [the secret's rule](../../packages/ui/README.md#configuration) in the contract. |
| `WP_MEDIA_ORIGIN` | Optional. The site base `/media/…` is rewritten under, as `{base}/wp-content/uploads/…`: an origin, optionally with the path WordPress is installed in (`https://example.com/blog`). Defaults to `WP_API_URL` without `/wp-json`. |
| `SITE_URL` | The site's public origin (`https://resources.example`): `https:`, or `http:` only for localhost, with no path, query, fragment or credentials, and never the CMS's origin. The root layout sets it as `metadataBase`, so every page's canonical link, `og:url` and `og:image` (and the `twitter:image` Next.js copies from it) are absolute on the public domain. Optional locally, where they stay relative; a Vercel build fails without it. |

All are server-only, read and validated in `lib/env.ts` when first used, never `NEXT_PUBLIC_`. `next.config.ts` reads `WP_API_URL` and `WP_MEDIA_ORIGIN` for the `/media/` rewrite (`lib/media-rewrites.ts`): with neither set, a Vercel build fails and a local or CI build leaves the rewrite out with a warning. Vercel builds are recognised by the `VERCEL` system variable, which is only present when the project exposes system environment variables to builds (a project setting, "Automatically expose System Environment Variables"); keep it on, or a Vercel build without a base deploys with every `/media/` image a 404. `next.config.ts` also checks `SITE_URL`: a malformed value fails every build, and on Vercel an unset one fails the build too. Set `WP_API_URL` and `SITE_URL` for both the Production and the Preview environments, because Preview builds fail without them; on Preview, `SITE_URL` is the production origin, so a preview's canonical points at the public page. They live in `.env.local` (gitignored) and in Vercel project settings, never in git.

## Routes

Every route is ISR, rendered on its first request and stored until a revalidation event or the hourly interval clears it; the build renders nothing from the CMS.

- `/resources/`, `/resources/[type]/`, `/resources/topic/[topic]/` and `/resources/[type]/topic/[topic]/`, each paginated as `…/page/[n]/`: the listings, thin shells over `components/ListingPage.tsx` with a filter bar, a list of rows and pagination, and on the library's first page the newest featured resource as a lead above the list (`packages/ui/DESIGN.md`, "Components"). A listing answers an unknown term or a page past the end with a stored 404 and never redirects. An old topic URL is a 404 after a re-slug; there is no topic redirect.
- `/resources/[type]/[slug]/`: the single resource (`components/ResourceArticle.tsx`), with its body through the one-pass renderer in `lib/content/render.tsx`. The slug is the identity: a wrong type segment, or an old slug found through the CMS's resolve route, gets one computed 308 to the canonical URL, stored and cleared by the resource's own events (`lib/redirects.ts`).
- `/` and `/[page]/…/`: the CMS's static front page and every other published WordPress page at its parent chain, from the root catch-all `app/[[...path]]/page.tsx` (`lib/page-request.ts`, `components/PageArticle.tsx`); a welcome page at `/` when no front page is set. A first segment the app's own routes use (`resources`, `api`, `media`, `_next`) is a 404 without a request.
- A mixed-case or otherwise non-canonical path, and a trailing `/page/1/`, is redirected by `proxy.ts` with a single-hop 308 and `Cache-Control: no-store` before any route runs (`lib/canonical-path.ts`). A path that can only be a 404 from its shape alone is rewritten there to the prerendered not-found page with status 404 (`lib/path-decision.ts`); every other 404 is the route's, through `components/DataNotFound.tsx`, with the same page in its HTML.
- `POST /api/revalidate/`: the on-demand revalidation route (`app/api/revalidate/route.ts`).

## Images

Images are served through the same-origin `/media/…` rewrite and rendered with `next/image` through Vercel's image optimizer, which resizes them per device and serves modern formats; the CMS host is never in `images.remotePatterns`, and `images.localPatterns` allows `/media/**` with no query string, so no one can vary the URL to spend the optimiser's allowance. Every CMS image renders with a width and a height inside a fixed-aspect box, so a late image moves nothing. The owner's Vercel plan includes 5,000 optimized images a month, which is the number to watch; the fallback if that ever becomes a problem is proxying the originals and WordPress's generated sizes through Cloudflare with no transformations. An image in a body on another host stays a plain lazy `<img>`; an image that names the CMS host but is not an upload is dropped (`lib/content/render.tsx`).

The optimiser serves AVIF, with WebP for a browser that does not accept it (`images.formats` in `next.config.ts`), and the CSS ships inline in the head (`experimental.inlineCss`), both for the LCP of the two sampled pages led by an image, the library and the resource page. On those pages Lighthouse's simulated LCP waits for every request that finished before the image painted, the framework's scripts included, not just the image: the scripts' 150 KB are most of it, the five render-blocking CSS files kept them off the browser's six connections until the CSS was in, and the image's own bytes counted only as bandwidth taken from the scripts. The comparison run, one build per row, measured with `pnpm web:test:lighthouse` (mobile, median of three), with `.next/cache/images` cleared before each build:

| Change | Library LCP | Resource LCP | LCP image (library / resource) |
| --- | ---: | ---: | --- |
| None (WebP, CSS as files) | 2473 ms | 2328 ms | 31.5 KB / 1.9 KB WebP |
| AVIF | 2326 ms | 2321 ms | 18.4 KB / 1.8 KB AVIF |
| `quality={65}` on the two images | 2468 ms | 2319 ms | 28.3 KB / 1.9 KB WebP |
| `sizes` from the gutter, `calc(100vw - 2rem)` | 2470 ms | 2320 ms | unchanged: Lighthouse's 412 px phone still picks the 750 width |
| No font preload | 2321 ms | 2323 ms | unchanged |
| CSS inline | 2320 ms | 2171 ms | unchanged |
| AVIF and CSS inline (shipped) | 2181 ms | 2170 ms | 18.4 KB / 1.8 KB AVIF |

The final gate run on the shipped build, a separate run of the same command, measured the library at 2169 ms and the resource page at 2167 ms; the table's last row is the comparison run's figure for the same code. In the comparison run the text-led pages' LCP and every page's FCP fell from about 903 to about 621 ms with the CSS inline, and the final gate run measured them at about 615 ms. The sampled CMS page, `/welcome/`, became image-led: its 240 × 160 diagram is 762 bytes as AVIF against 573 as WebP, which at Lighthouse's device pixel ratio of 1.75 puts it just over the 0.05 bits per pixel Chrome needs to count an image as the LCP, so it measures 2170 ms on the same scripts as the other two instead of its text at about 903. The font preload stays: removing it saved the library as much as AVIF did but nothing on the resource page, and it is what puts Figtree on the first paint (`packages/ui/DESIGN.md`, "Font display"). AVIF costs on Vercel: it encodes more slowly than WebP, so the first request for each width of an image waits longer until the optimiser has cached it, and an image served in both formats counts as two transformations against the plan's allowance. Inline CSS costs HTML that a returning reader cannot cache apart from the page: on the harness's build the library's inlined `<style>` is 14,029 bytes raw and 2,964 gzipped, the resource page's 11,699 and 2,655, and a CMS page's 10,104 and 2,467, plus a second copy of the CSS in the RSC payload. The flag is experimental and acts only in a production build, so on any Next.js upgrade re-run `pnpm web:test:lighthouse` and read the built HTML's `<head>`; `e2e/harness.spec.ts` fails if the CSS stops shipping inline.

## Status

The listings, the single resource, the CMS's pages, the data layer, the content renderer and the revalidation route are in, all ISR. The related section that swaps the block marker for a `<RelatedResources>` component is slice 4 ([issue #50](https://github.com/Colbitron/resource-hub-wp/issues/50)). CI lints, typechecks, builds and runs the unit and end-to-end tests, then the design gates on the same build: axe, the specimen's screenshots and Lighthouse CI ([`e2e/README.md`](e2e/README.md#the-design-gates)).

## Possible next steps

Only once the core is green, in this order:

1. A GraphQL data path beside REST, once the plugin adds WPGraphQL, with a short written comparison.
2. Draft preview through the signed token from the plugin.
