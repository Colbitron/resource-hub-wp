# Resource Hub: Next.js front end

The front end of the project, at `apps/web/`. The root `CLAUDE.md` holds what applies to the whole project; read it first. This file holds the rules for every edit in this app. How the pieces work is in `docs/architecture/caching.md` and `docs/architecture/revalidation.md`, the contract in `packages/ui/README.md`, and each module's reasoning in its docblock.

## Hard constraints

- **The CMS URL never reaches the browser.** `WP_API_URL` is server-only (never `NEXT_PUBLIC_`), every CMS request happens on the Next.js server, and every CMS URL in rendered output is rewritten (ADR 0040). This reduces exposure; it is not a security boundary.
- **Never `dangerouslySetInnerHTML`.** CMS HTML goes through the one pass in `lib/content/render.tsx`, which renders React nodes from an allow-list; kses is no guard, because editors have `unfiltered_html`.

## What it is

A Next.js App Router app, TypeScript, deployed on Vercel, that renders a resources library and the CMS's pages from the WordPress REST API and rebuilds pages on demand when the CMS says so.

**Core (the demo does not ship without all of it):**
1. **Routes**, all server-rendered, all with a trailing slash (`trailingSlash: true`), mirroring the CMS's permalinks: the listings `/resources/`, `/resources/[type]/`, `/resources/topic/[topic]/` and `/resources/[type]/topic/[topic]/`, each paginated as `…/page/[n]/`; the single resource `/resources/[type]/[slug]/`; and the CMS's pages, `/` and `/[page]/…/`, from the root catch-all `app/[[...path]]/`. Rules for every route:
   - Filters and pagination are path segments, never `searchParams`; one topic and one type at a time; `topic` and `page` are reserved.
   - Every route is ISR: `export const revalidate = 3600` as a literal, a `generateStaticParams` returning `[]`, no `connection()`, `headers()`, `cookies()` or `force-dynamic`, and no `loading.tsx`. The unit tests under `test/` pin this per route. The build never needs the CMS.
   - A page that can redirect or 404 decides before anything renders and outside any Suspense boundary (`resourceForRequest` in `lib/redirects.ts`, `pageForRequest` in `lib/page-request.ts`), in the page and in `generateMetadata`. A listing never redirects; it answers `notFound()` or a 200.
   - Never send a permanent redirect without a cache header. Redirects decidable from the path alone come from `proxy.ts` with `no-store`, which must stay free of the data layer; redirects that need data come from the pages and are stored, with the `headers()` rule in `lib/route-headers.ts` keeping browsers asking (ADR 0025).
   - Every slug in a path or tag goes through `canonicalSlug` and the builders in `lib/routes.ts`; never build a path or tag by hand.
   - Rendered bodies go through `renderContent` in `lib/content/render.tsx`: links lose the CMS domain, images become `/media/…`, the block marker is handed to `renderBlock`, all in one server-side pass.
2. **Data layer** in `lib/wp/`, server-only: every CMS read goes through `cmsGet` and `cmsGetList` in `lib/wp/fetch.ts`, a `fetch` with `cache: "force-cache"` and the tags the functions in `lib/tags.ts` give it, parsed with the Zod readers in `lib/wp/schemas/` (derived from the shared JSON Schemas plus the core REST payloads), so a CMS change fails loudly. A read outside the wrapper is outside the Data Cache, and no tag can clear it. Errors never name the CMS origin.
3. **`app/api/revalidate/route.ts`**, served at `/api/revalidate/`: the on-demand revalidation endpoint per the contract. Secret, then auth, then a capped body, then `revalidateTag(tag, { expire: 0 })` and `revalidatePath` for the union of each event's current and previous state; it fetches nothing. It is the front end's critical path, read line by line before merge.
4. **Accessibility and performance as gates, not claims:** semantic landmarks, keyboard-reachable filters, no layout shift from late content, and `next/image` with sized images from the same-origin `/media/…` rewrite. Lighthouse mobile performance and accessibility both 95 or better on `/resources/` and a single resource.
5. **Tests and gates:** TypeScript strict, ESLint, Vitest unit tests, Playwright end to end against the mock CMS, all in GitHub Actions on every push; Vercel preview deploys per PR.

**Stretch, in order, only once core is green:**
1. A GraphQL data path beside REST (when the plugin side adds WPGraphQL), with a short written comparison.
2. Draft preview via the signed token from the plugin.
3. Lighthouse CI budgets and an axe check inside the Playwright run so the numbers are produced by the pipeline, not read off a screenshot.

## Standards and workflow

- Next.js 16, App Router, TypeScript strict, pnpm. Server Components by default; client components only for the filter controls and the listing focus. Styling is plain CSS on the shared tokens, no framework and no web fonts: component styles come from `@colbitron/resource-hub-ui` (`"workspace:*"` in this app's `package.json`) and are imported by the component that renders the markup; `components/Shell.tsx` imports the tokens and the app's own `shell.css`, never `layout.tsx`. Test-only pages are `app/**/page.fixture.tsx`, routes only under `RH_FIXTURES=1`, which Playwright's web server sets.
- `AGENTS.md` here is written by `next dev`: this Next.js version differs from older ones, so read the relevant guide in `node_modules/next/dist/docs/` before writing code.
- The caching model, the tags, the stored responses and the redirect rules are in `docs/architecture/caching.md`; the revalidate route's behaviour is in `docs/architecture/revalidation.md`. The module docblocks in `lib/tags.ts`, `lib/wp/fetch.ts`, `lib/redirects.ts`, `lib/page-request.ts`, `lib/canonical-path.ts`, `lib/content/render.tsx` and `app/api/revalidate/route.ts` hold the rules of each piece; read the docblock before changing a module. Open decisions are issues #51 (an unreadable event), #52 (the `/media/` rewrite), #53 (the content pass) and #54 (flag terms).
- End-to-end specs are `e2e/*.spec.ts`; `pnpm web:test:e2e` starts the mock CMS in `e2e/mock-cms/`, builds the app with the fixture routes and runs the specs against `next start`. One worker, because every spec resets the mock in `beforeEach`. Ports 3310 (app) and 4010 (mock), overridable with `RH_WEB_PORT` and `RH_MOCK_CMS_PORT`. Front-end e2e never uses wp-env or the hosted CMS; `e2e/README.md` has the routes, the controls and the seed. Playwright's Chromium must be installed (`pnpm exec playwright install chromium` in `apps/web`).
- Local work: run `pnpm web:dev` from the repository root, with `WP_API_URL` in `.env.local` pointing at the wp-env CMS, `http://localhost:8888/wp-json` by default.

## Follow-ups

- **A 404 page in the HTML for `notFound()`** ([issue #46](https://github.com/Colbitron/resource-hub-wp/issues/46)): on Next.js 16.4.5 a `notFound()` decided by data is sent as the framework's empty `__next_error__` document, with `app/not-found.tsx` arriving on hydration, and ISR stores that same document. Since the root catch-all claims every unmatched URL, no 404 has the page in its HTML. A `proxy.ts` rewrite to a no-match path would render it for 404s decidable from the path alone; the data-dependent case needs Next.js upstream. Pinned in `e2e/errors.spec.ts`.
