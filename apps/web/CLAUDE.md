# Resource Hub: Next.js front end

The front-end half of a two-repo headless WordPress demo. The other half is `../resource-hub-wp` (the WordPress plugin and wp-env). Read both CLAUDE.md files before changing the contract in either.

## Standards to build to

React, TypeScript, Next.js; REST (GraphQL as a stretch); Playwright; GitHub Actions; WCAG and Core Web Vitals. The reference shape is a headless WordPress site on Next.js and Vercel with ISR and on-demand revalidation from the CMS; this should look like a small, clean instance of that shape. Ambition here means depth, not feature count: fast, accessible, tested, and every choice explainable in one sentence.

## Hard constraints

- **Fresh, generic code only.** Nothing here may be copied or adapted from any prior employer's codebase or packages. Generic Next.js patterns only; when in doubt, write it the textbook way and record the choice.
- **Never describe this as production code.** It is a demonstration of a pattern, written fresh.
- **No secrets in git.** `REVALIDATE_SECRET` and `WP_API_URL` live in `.env.local` (gitignored) and in Vercel project settings.

## What it is

A Next.js App Router app, TypeScript, deployed on Vercel, that renders a resources library from the WordPress REST API and rebuilds pages on demand when the CMS says so.

**Core (the demo does not ship without all of it):**
1. `/resources`: listing with filters by topic and type via search params, server-rendered, with pagination. `/resources/[slug]`: the single resource, including the related items from the plugin's custom route.
2. Data layer in `lib/wp/`: typed fetchers over `fetch` with `next: { tags: [...] }` so revalidation is tag-based (`resources`, `resource:{slug}`, `topic:{slug}`), and Zod (or equivalent) parsing of the REST payloads so a CMS change fails loudly, not silently.
3. `app/api/revalidate/route.ts`: the on-demand revalidation endpoint per the contract below. Constant-time bearer comparison, body validation, `revalidateTag` and `revalidatePath` as appropriate, and the exact response shapes the plugin expects.
4. Static generation with ISR as the safety net (a long `revalidate` interval) and on-demand revalidation as the primary path. Record the reasoning as an ADR.
5. Accessibility and performance as gates, not claims: semantic landmarks, keyboard-reachable filters, `next/image` with sized images, no layout shift from late content. Lighthouse mobile performance and accessibility both 95 or better on `/resources` and a single resource.
6. Tests and gates: TypeScript strict, ESLint, Playwright end to end (filtering works; the revalidate route rejects a bad bearer and a bad body and accepts a good one), all in GitHub Actions on every push; Vercel preview deploys per PR.
7. `README.md` with the architecture diagram shared with the WordPress repo and a decisions section; ADRs under `docs/adr/`.

**Stretch, in order, only once core is green:**
1. A GraphQL data path beside REST (when the plugin side adds WPGraphQL), with a short written comparison.
2. Draft preview via the signed token from the plugin.
3. Lighthouse CI budgets and an axe check inside the Playwright run so the numbers are produced by the pipeline, not read off a screenshot.

## The contract with the CMS

Change this only by changing both repos in the same sitting.

- **Content read:** `GET {WP_API_URL}/wp/v2/resources?_embed&per_page=…&resource_topic=…&resource_type=…`, `GET {WP_API_URL}/wp/v2/resources/{id}` (and by slug via `?slug=`), the `resource_topic` and `resource_type` taxonomy endpoints, and `GET {WP_API_URL}/resource-hub/v1/related/{id}?count=3`. Meta fields `summary`, `source_url`, `featured` arrive under `meta`.
- **Revalidation request** (CMS to this app): `POST /api/revalidate`, header `Authorization: Bearer {REVALIDATE_SECRET}`, JSON body:
  ```json
  { "type": "resource", "event": "publish" | "update" | "trash", "id": 123, "slug": "example", "rest_url": "https://cms.example/wp-json/wp/v2/resources/123", "topics": ["topic-slug"], "types": ["type-slug"] }
  ```
- **Revalidation response:** `200 { "revalidated": ["/resources", "/resources/example"] }` listing what was invalidated; `400 { "error": "…" }` for a malformed body; `401 { "error": "unauthorized" }` for a bad or missing bearer; `500 { "error": "…" }` on failure. The plugin shows these to the editor, so the messages must be plain and accurate.
- **Configuration on this side:** `WP_API_URL` (the CMS's `/wp-json` base) and `REVALIDATE_SECRET`.

## Standards and workflow

- Next.js 16, App Router, TypeScript strict, pnpm. Server Components by default; client components only for the filter controls. No CSS framework decision has been made; keep styling small and dependency-light, and record the choice as an ADR.
- Agent-first build. The code is written by agents and reviewed by a human: the revalidate route and the data layer's parsing get read line by line before merge; the rest goes through the gate. The gate is typecheck, lint, Playwright, and a reviewer agent on a different model than the implementer. Nothing merges until all of it passes.
- Work on branches and open pull requests so the review has a diff to read. Small PRs, one concern each. Commit messages say what and why.
- Record each real decision as an ADR as it is made (tags versus paths for revalidation, ISR interval, REST versus GraphQL, styling). These are the project's talking points.
- Local toolchain as of 2026-11-03: Node 24 and pnpm present. The CMS runs in `../resource-hub-wp` under wp-env (Docker) at `http://localhost:8888` by default; point `WP_API_URL` there for local work.
