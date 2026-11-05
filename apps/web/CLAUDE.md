# Resource Hub: Next.js front end

The front end of the project, at `apps/web/`. The root `CLAUDE.md` holds what applies to the whole project, including the hard constraints, the workflow, the deploy order and the contract with the CMS, in one copy; read it first. This file holds what applies only to this app.

## Hard constraints

- **The CMS URL never reaches the browser.** `WP_API_URL` is server-only (never `NEXT_PUBLIC_`), every CMS request happens on the Next.js server, and every CMS URL in rendered output is rewritten (ADR 0040). This reduces exposure; it is not a security boundary.

## What it is

A Next.js App Router app, TypeScript, deployed on Vercel, that renders a resources library from the WordPress REST API and rebuilds pages on demand when the CMS says so.

**Core (the demo does not ship without all of it):**
1. Routes, all server-rendered, all with a trailing slash (`trailingSlash: true`), mirroring the CMS's permalinks: `/resources/` (everything), `/resources/[type]/` (one type), `/resources/topic/[topic]/` (one topic), `/resources/[type]/topic/[topic]/` (one type within one topic), each paginated as `…/page/[n]/`, and `/resources/[type]/[slug]/` (the single resource, including the related items from the plugin's related route). Filters and pagination are path segments, never search params, because reading `searchParams` makes an App Router page dynamic; one topic and one type at a time (ADR 0034). `topic` and `page` are reserved and never type slugs. On a single resource the slug is the identity and the type segment is checked: a wrong type, or an old slug found through the plugin's resolve route (called only when the current-slug lookup misses), gets a computed single-hop 308 to the canonical URL with `Cache-Control: no-store`; never send a permanent redirect without a cache header (ADR 0035). That requirement is fixed; the mechanism is chosen and verified in slice 3, because `permanentRedirect()` documents no way to set response headers and falls back to a meta refresh while streaming: slice 3 checks what Vercel sends and otherwise uses `proxy.ts` or a route handler that sets the headers itself. The rendered body has the CMS domain stripped from every link (ADR 0036), its images rewritten to `/media/…` (ADR 0040) and the related-resources block marker swapped for a server component (ADR 0037), all in one parse pass on the server.
2. Data layer in `lib/wp/`, server-only: typed fetchers over `fetch` with `next: { tags: [...] }` so revalidation is tag-based (`resources`, `resource:{slug}`, `topic:{slug}`, `type:{slug}`), and Zod parsing derived from the shared JSON Schemas (see the contract in the root `CLAUDE.md`) plus the core REST payloads, so a CMS change fails loudly, not silently.
3. `app/api/revalidate/route.ts`, served at `/api/revalidate/`: the on-demand revalidation endpoint per the contract in the root `CLAUDE.md`. It is served at `/api/revalidate/`, with the slash, because `trailingSlash: true` answers `/api/revalidate` with a 308 that the plugin's POST will not follow, so the plugin must post to the slashed path; the plugin and the contract text in the root `CLAUDE.md` move to it in their own contract pull request, which has not landed yet (ADR 0043). Constant-time bearer comparison, body validation against the schema, `revalidateTag` and `revalidatePath` for the union of each event's current and previous state, and the exact response shapes the plugin expects.
4. Static generation with ISR as the safety net (a long `revalidate` interval) and on-demand revalidation as the primary path. Record the reasoning as an ADR.
5. Accessibility and performance as gates, not claims: semantic landmarks, keyboard-reachable filters, no layout shift from late content, and `next/image` with sized images through Vercel's image optimizer, sourced from the same-origin `/media/…` rewrite (ADRs 0039, 0040). The owner's plan includes 5,000 optimized images a month; the fallback is proxying the originals and WordPress's sizes through Cloudflare with no transformations. Lighthouse mobile performance and accessibility both 95 or better on `/resources` and a single resource.
6. Tests and gates: TypeScript strict, ESLint, Playwright end to end (filtering works; the revalidate route rejects a bad bearer and a bad body and accepts a good one), all in GitHub Actions on every push; Vercel preview deploys per PR.

**Stretch, in order, only once core is green:**
1. A GraphQL data path beside REST (when the plugin side adds WPGraphQL), with a short written comparison.
2. Draft preview via the signed token from the plugin.
3. Lighthouse CI budgets and an axe check inside the Playwright run so the numbers are produced by the pipeline, not read off a screenshot.

## Standards and workflow

- Next.js 16, App Router, TypeScript strict, pnpm. Server Components by default; client components only for the filter controls. No CSS framework decision has been made; keep styling small and dependency-light, and record the choice as an ADR.
- `AGENTS.md` here is written by `next dev`: this Next.js version differs from older ones, so read the relevant guide in `node_modules/next/dist/docs/` before writing code.
- ADR 0043 records the caching model: the `fetch` Data Cache with `next: { tags }`, a route `revalidate` as the ISR safety net, and `revalidateTag` plus `revalidatePath` from the revalidate route, without Cache Components. Decisions still to record as ADRs for this app: which tags and paths each event revalidates, the ISR interval's value, the `revalidateTag` profile, the `/media/` rewrite versus a Route Handler (pending in ADR 0040's 2026-11-05 amendment), REST versus GraphQL, and styling. These are the project's talking points.
- The shared package comes from the workspace: add `"@colbitron/resource-hub-ui": "workspace:*"` to this app's `package.json` when it first imports a schema or stylesheet (ADR 0041).
- Local work: run `pnpm web:dev` from the repository root (or `pnpm dev` here), with `WP_API_URL` in `.env.local` pointing at the wp-env CMS, `http://localhost:8888/wp-json` by default.
