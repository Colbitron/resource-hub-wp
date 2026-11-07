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

**What changed.** The build prerenders a bounded set from the CMS: the 50 most recent resources plus the 10 most recent of each type, the root `/`, the library `/resources/` and each type's first page. Each route's `generateStaticParams` probes the CMS and returns the paths that answered; any failure falls back to `[]`, and the build script empties the fetch cache first so the probe reads live. Everything else stays on-demand ISR, with `dynamicParams`, `revalidate` and the tags unchanged.

**Why.** Next.js 16 writes its prefetch-hint manifest only for routes with a prerendered path, and an ISR route without an entry has prefetch disabled on every segment. With `[]` everywhere, `<Link>` fetched nothing for any library row: a click from the library to a resource measured a median of 454 ms on a throttled mobile profile, against 61 ms with the row prefetched.

**How the rule's purpose still holds.** The rule existed so a deploy could never fail because the CMS was down, and it still cannot: a CMS that is absent, down, slow or unreadable costs one warning per route and no prerendered page, and every page renders on its first request as before. What the rule gave up is that the build is a function of the code alone.

**Options weighed.**

- Prerender nothing, the status quo: it is what disabled prefetching.
- Prerender everything: grows without bound with what editors add.
- `prefetch={true}` on the row links: about 43 KB per visible row against about 6 KB, and an ISR render per prefetch for an unopened row.
- A bounded set with a fallback to `[]`: chosen.

**Consequences.**

- Every build that can reach the CMS reads it, about 40 to 140 requests, previews included; a preview whose reads fail falls back and still deploys.
- An event fired during a build clears the live deployment only, so the new deployment's prerendered pages carry pre-event data until the next event or the hourly interval.
- The set is fixed at build; a deploy whose build the CMS did not answer keeps prefetch off until the next one.

The budgets, the partial results, the param decoding and the measurements are in [`docs/architecture/caching.md`](../architecture/caching.md), "Prefetching".
