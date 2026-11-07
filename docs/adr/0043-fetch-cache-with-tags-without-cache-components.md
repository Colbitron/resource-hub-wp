---
status: accepted
date: 2026-11-05
merges: 0023, and the cores of 0046 and 0050 (2026-11-06)
amended: 2026-11-07
---

# The caching model: the `fetch` Data Cache with tags, the only HTTP cache, cleared by the union of each event's states, with a build that never fails because of the CMS

Next.js 16 has two caching models. Cache Components (`cacheComponents: true`, the `create-next-app` default) caches with `'use cache'`, `cacheLife` and `cacheTag` and treats every uncached fetch as request-time data. The previous model caches individual `fetch` calls with `next: { tags, revalidate }` and the route segment `revalidate`, and invalidates them with `revalidateTag` and `revalidatePath`. The front end uses the previous model, and four rules follow from it.

**Where the cache lives decides it.** The `fetch` Data Cache persists across deployments and serverless instances; `'use cache'` defaults to in-memory storage, discarded when an instance is destroyed and scoped to one deployment, and durable storage for it needs a remote cache with platform fees. On Vercel, on-demand revalidation is only as good as the cache it clears. Every read this app makes is a `fetch`, so the Data Cache covers all of it with tags and no new storage.

**The Data Cache is the only HTTP cache for REST responses.** Varnish and Cloudflare sit between the front end and WordPress, and a copy cached there would survive a revalidation: Next.js would refetch and receive the stale copy. The plugin adds a [no-cache header](../../packages/ui/README.md#how-the-two-sides-talk) to every anonymous response on the routes the front end reads, errors included, so the one cache the revalidate route can clear is the only one that stores them. Verified 2026-11-05 that the header does not stop the Data Cache storing the response.

**Every event clears the union of its current and previous state.** The route clears the tags and paths of both states and never diffs the two; which tags each event clears is in [`caching.md`](../architecture/caching.md#tags-and-what-each-event-clears) and the tag names in the [contract](../../packages/ui/README.md#semantics-the-schemas-assume). `terms` is produced by term events only and carried by every fetch that embeds or lists terms, so a rename reaches every page that shows the name, which the event cannot name. Tags are fixed from the request, never from the response, so a miss is cached under the tags a later publish clears. Pagination is covered by tags only.

**The build never needs the CMS.** *Amended 2026-11-07 (see Amendments below).* Every route is ISR with `generateStaticParams` returning `[]` and a route `revalidate` as the safety net, so `next build` renders nothing from WordPress. A build that rendered pages from the CMS would couple a front-end deploy to the CMS being up and in step and make preview builds fail for reasons unrelated to the change; with no page prerendered, the build is a function of the code alone, and the deploy order (CMS first) keeps the first renders correct.

## Considered options

- **Cache Components.** The direction of the framework. Rejected for now: durable storage would cost a remote cache; the route segment `revalidate` is replaced by `cacheLife`; and rendering would change (a prerendered shell with streamed holes) for no gain on pages that are static between revalidations.
- **`unstable_cache` around the data layer.** Rejected: every read is a `fetch`, which the Data Cache already tags, and the API is superseded in 16.
- **A Varnish exclusion rule on the host.** Not added: Varnish passed `/wp-json` when checked, and a panel rule would live outside the repository.
- **Tag every fetch `resources` and let term events clear that.** Rejected: every resource event would then clear every page.
- **Enumerate paginated paths.** Rejected: the event cannot know the page count, and fetching it would put a CMS request in the revalidate route.
- **Tag a fetch from its response.** Rejected: a miss has no response to tag from, and a cached miss would outlive the publish that should clear it.
- **Prerender every listing at build.** Rejected: a build that depends on the CMS and grows with the topics editors add.

## Consequences

- `fetch` is not cached by default in 16, so every CMS read opts in with `cache: 'force-cache'` and its tags through one wrapper; a read outside it is outside the Data Cache, and no tag can clear it. `cacheComponents` stays off, and `'use cache'` and `unstable_cache` are not used.
- `revalidateTag` takes a profile in 16; the route uses `{ expire: 0 }`, so a removal never serves one more stale render, at the cost of one blocking refetch per cleared entry.
- The data layer calls the fetch-tag functions in `lib/tags.ts` rather than build tags by hand, and a unit test checks every fetch's tags against a hand-written table.
- Every resource event re-renders every stored listing (the filter bar's term lists carry `resources`), and every distinct junk path stores its own 404. Both are accepted; the tags, the stored responses, the measurements and the costs are in [`docs/architecture/caching.md`](../architecture/caching.md).
- Moving to Cache Components later is a contained change: the migration guide maps each `fetch` option to its counterpart, and `revalidateTag` keeps working.

## Amendments

### 2026-11-07: prerender a bounded set at build

**What changed.** Four routes prerender from the CMS at build: the library's first page `/resources/`, each type's first page `/resources/{type}/`, the root `/`, and the resource pages for the union of the 50 most recently published resources and the 10 most recent of each type, each slug once (`RECENT_RESOURCES` and `RECENT_PER_TYPE` in `apps/web/lib/prerender.ts`). Each `generateStaticParams` calls a probe there, which makes the page's own reads through the data layer under a budget (10 s per route, 30 s for the resource route, on top of the data layer's 10 s per request) and returns the params whose reads succeeded: all of them, the ones decided when the budget ran out, or `[]` with one build warning when a list fails or more than half of the resource candidates do; a candidate whose own read fails is skipped and counted in that warning. The `build` script empties `.next/cache/fetch-cache` first, so the probes read the CMS live rather than a previous build's answers. Every other `generateStaticParams` still returns `[]`: topic listings, later pages and other CMS pages grow with what editors add and render on their first request. `dynamicParams`, `revalidate` and the tags are unchanged, so a prerendered page and one rendered on demand are stored, served and cleared the same way.

**Why.** Next.js 16.4.5 writes a prefetch-hint manifest only for routes with at least one prerendered path, and an ISR route rendered at runtime without a manifest entry has every segment marked `PrefetchDisabled`. With `[]` everywhere, `<Link>` fetched nothing for any library row, and a click from the library to a resource was a full round trip: a median of 454 ms on a throttled mobile profile against 61 ms once the row is prefetched (`docs/architecture/caching.md`, "Prefetching"). The same `[]` kept the pages a reader opens first off the CDN until their first visitor.

**How the original rule's purpose still holds.** The rule was there so a front-end deploy could never fail because the CMS was down, and it still cannot: a probe that meets a CMS that is absent (CI's `cms.example` placeholder), down, slow or answering something the reader schemas refuse returns `[]`, the build prerenders nothing from the CMS and passes, and every page renders on its first request as before. Because every data-layer read is a `fetch` with `cache: "force-cache"`, a page the probe named is rendered from reads already in the Data Cache; the one read a render can repeat is the library's lead, whose failure the listing contains. What the rule gave up is that the build is a function of the code alone: a build with the CMS up and one with it down differ in which pages are stored at deploy, and both serve every page. The deploy order (CMS first) still keeps the first renders correct.

**Options weighed.**

- Prerender nothing, the status quo: it is what disabled prefetching, and it kept the entry pages off the CDN.
- Prerender everything, every listing, every page of every listing, every resource: the build would grow without bound with what editors add, and take as long as the CMS is slow (the "prerender every listing" option above, still rejected).
- `prefetch={true}` on the row links, leaving the build alone: the full page data for every visible row, about 43 KB each against about 5.9 KB for a route tree and a page segment, and for a row no reader has opened an ISR render per prefetch on every library view.
- A bounded set with a probe that falls back to `[]`: chosen.

**Consequences.**

- Every build that can reach the CMS reads it: about 40 requests for the seed, up to about 140 with five full types, from CI's end-to-end build against the mock and from every Vercel preview and production build against the hosted CMS, the probes' lists and term lookups plus one slug lookup per candidate. A preview build whose reads fail prerenders nothing and still deploys; this is the concern the original rule answered, and the fallback is what answers it now.
- A stale window during a build: a revalidation event fired while a build runs clears the live deployment, not the build in progress, so the new deployment's prerendered pages carry pre-event data until the next event or the hourly interval clears them.
- The row prefetch depends on the resource route being in the manifest, which needs at least one prerendered resource; a deploy whose build the CMS did not answer keeps the old behaviour until the next deploy.
- The set is the build's: `generateStaticParams` is not run again at revalidation, so a resource published after the deploy renders on its first request, and the manifest entry the route already has keeps its prefetching on.
- A route that imports the probe module imports what it reads with, and Next.js inlines every stylesheet in a route's module graph into that route's HTML; the listing's reads therefore live in `lib/listing-data.ts`, with no CSS, not in the component.
- A `generateStaticParams` value is decoded (`paramValue`), because Next.js encodes each param once and keys the page by the decoded path; passed as WordPress stores it, a non-ASCII slug was prerendered at `%25…` and never matched its own URL.
- The e2e harness builds with the mock up and tests the prerendered set (`apps/web/e2e/prefetch.spec.ts`); the selection, the probes, the partial result and the fallback are unit-tested in `apps/web/test/prerender.test.ts`. The measurements and the method are in [`docs/architecture/caching.md`](../architecture/caching.md), "Prefetching".
