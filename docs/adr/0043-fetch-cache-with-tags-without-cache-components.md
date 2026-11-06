---
status: accepted
date: 2026-11-05
merges: 0023, and the cores of 0046 and 0050 (2026-11-06)
---

# The caching model: the `fetch` Data Cache with tags, the only HTTP cache, cleared by the union of each event's states, with a build that never needs the CMS

Next.js 16 has two caching models. Cache Components (`cacheComponents: true`, the `create-next-app` default) caches with `'use cache'`, `cacheLife` and `cacheTag` and treats every uncached fetch as request-time data. The previous model caches individual `fetch` calls with `next: { tags, revalidate }` and the route segment `revalidate`, and invalidates them with `revalidateTag` and `revalidatePath`. The front end uses the previous model, and four rules follow from it.

**Where the cache lives decides it.** The `fetch` Data Cache persists across deployments and serverless instances; `'use cache'` defaults to in-memory storage, discarded when an instance is destroyed and scoped to one deployment, and durable storage for it needs a remote cache with platform fees. On Vercel, on-demand revalidation is only as good as the cache it clears. Every read this app makes is a `fetch`, so the Data Cache covers all of it with tags and no new storage.

**The Data Cache is the only HTTP cache for REST responses.** Varnish and Cloudflare sit between the front end and WordPress, and a copy cached there would survive a revalidation: Next.js would refetch and receive the stale copy. The plugin adds a [no-cache header](../../packages/ui/README.md#how-the-two-sides-talk) to every anonymous response on the routes the front end reads, errors included, so the one cache the revalidate route can clear is the only one that stores them. Verified 2026-11-05 that the header does not stop the Data Cache storing the response.

**Every event clears the union of its current and previous state.** The route clears the tags and paths of both states and never diffs the two; which tags each event clears is in [`caching.md`](../architecture/caching.md#tags-and-what-each-event-clears) and the tag names in the [contract](../../packages/ui/README.md#semantics-the-schemas-assume). `terms` is produced by term events only and carried by every fetch that embeds or lists terms, so a rename reaches every page that shows the name, which the event cannot name. Tags are fixed from the request, never from the response, so a miss is cached under the tags a later publish clears. Pagination is covered by tags only.

**The build never needs the CMS.** Every route is ISR with `generateStaticParams` returning `[]` and a route `revalidate` as the safety net, so `next build` renders nothing from WordPress. A build that rendered pages from the CMS would couple a front-end deploy to the CMS being up and in step and make preview builds fail for reasons unrelated to the change; with no page prerendered, the build is a function of the code alone, and the deploy order (CMS first) keeps the first renders correct.

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
