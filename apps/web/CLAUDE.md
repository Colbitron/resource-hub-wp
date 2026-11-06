# Resource Hub: Next.js front end

The front end of the project, at `apps/web/`. The root `CLAUDE.md` holds what applies to the whole project; read it first. This file holds the rules for every edit in this app. Rules for one area load from `.claude/rules/` when you touch its files: `caching-and-redirects.md` for routes, the data layer and redirects, `revalidation.md` for the revalidate route and the tags, `contract.md` for the readers and shared paths. How the pieces work is in `docs/architecture/caching.md` and `docs/architecture/revalidation.md`, the contract in `packages/ui/README.md`, running and configuring the app in `README.md`, and each module's reasoning in its docblock.

## Hard constraints

- **The CMS URL never reaches the browser.** `WP_API_URL` is server-only (never `NEXT_PUBLIC_`), every CMS request happens on the Next.js server, every CMS URL in rendered output is rewritten, and no error message names the CMS origin (ADR 0040). This reduces exposure; it is not a security boundary.
- **Never `dangerouslySetInnerHTML`.** CMS HTML goes through `renderContent`, the one server-side pass in `lib/content/render.tsx`, which renders React nodes from an allow-list, strips the CMS domain from links, rewrites images to `/media/…` and hands the block marker to `renderBlock`. kses is no guard, because editors have `unfiltered_html`.

## What it is

A Next.js App Router app, TypeScript, deployed on Vercel, that renders a resources library and the CMS's pages from the WordPress REST API and rebuilds pages on demand when the CMS says so.

**Core (the demo does not ship without all of it):**
1. **Routes**, all with a trailing slash (`trailingSlash: true`), mirroring the CMS's permalinks: the listings under `app/resources/`, the single resource `/resources/[type]/[slug]/`, and the CMS's pages, `/` and `/[page]/…/`, from the root catch-all `app/[[...path]]/`. The route list is in `README.md`.
2. **Data layer** in `lib/wp/`, server-only.
3. **`app/api/revalidate/route.ts`**, the on-demand revalidation endpoint.
4. **Accessibility and performance gates:** semantic landmarks, keyboard-reachable filters, no layout shift from late content, and `next/image` with sized images from the same-origin `/media/…` rewrite. Lighthouse mobile performance and accessibility both 95 or better on `/resources/` and a single resource.
5. **Tests and gates:** TypeScript strict, ESLint, Vitest unit tests, Playwright end to end against the mock CMS, all in GitHub Actions on every push; Vercel preview deploys per PR.

## Standards and workflow

- Next.js 16, App Router, TypeScript strict, pnpm. Server Components by default; client components only for the filter controls and the listing focus. Styling is plain CSS on the shared tokens, no framework and no web fonts: component styles come from `@colbitron/resource-hub-ui` (`"workspace:*"` in this app's `package.json`) and are imported by the component that renders the markup; `components/Shell.tsx` imports the tokens and the app's own `shell.css`, never `layout.tsx`. Test-only pages are `app/**/page.fixture.tsx`, routes only under `RH_FIXTURES=1`, which Playwright's web server sets.
- `AGENTS.md` here is written by `next dev`: this Next.js version differs from older ones, so read the relevant guide in `node_modules/next/dist/docs/` before writing code.
- The module docblocks in `lib/tags.ts`, `lib/wp/fetch.ts`, `lib/redirects.ts`, `lib/page-request.ts`, `lib/canonical-path.ts`, `lib/content/render.tsx` and `app/api/revalidate/route.ts` hold the rules of each piece; read the docblock before changing a module. Open decisions are issues #51 (an unreadable event), #52 (the `/media/` rewrite), #53 (the content pass) and #54 (flag terms).
- End-to-end specs are `e2e/*.spec.ts`, run with `pnpm web:test:e2e` against the mock CMS in `e2e/mock-cms/`, never wp-env or the hosted CMS. `e2e/README.md` has the setup, the ports, the routes, the controls and the seed.
