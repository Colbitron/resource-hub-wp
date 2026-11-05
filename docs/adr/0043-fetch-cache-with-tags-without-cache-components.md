---
status: accepted
date: 2026-11-05
---

# The front end caches with `fetch` and tags, without Cache Components

Next.js 16 has two caching models. Cache Components (`cacheComponents: true`, which `create-next-app` 16 turns on) caches with the `'use cache'` directive, `cacheLife` and `cacheTag`, and treats every uncached fetch as request-time data. The previous model, which the 16.4.5 docs still document in full ("Caching and Revalidating (Previous Model)"), caches individual `fetch` calls and tunes them with `next: { tags, revalidate }` and the route segment `revalidate`, and invalidates them with `revalidateTag` and `revalidatePath`.

The front end uses the previous model. The data layer in `lib/wp/` and the revalidate route are not written yet; when they are, they must follow it. Every CMS read in `lib/wp/` must be a `fetch` with `cache: 'force-cache'` and `next: { tags: [...] }` (`resources`, `resource:{slug}`, `topic:{slug}`, `type:{slug}`), pages will set a long route `revalidate` as the ISR safety net, and the revalidate route will call `revalidateTag(tag, …)` with an explicit profile and `revalidatePath` for the union of each event's current and previous state. `cacheComponents` stays off in `next.config.ts`, and `'use cache'` and `unstable_cache` must not be used.

The reason is where the cache lives. The 16.4.5 migration guide says the `fetch` Data Cache "persists cached responses across deployments and across serverless instances", while `'use cache'` "defaults to in-memory storage, so its entries are discarded when the serverless instance is destroyed and are scoped to a single deployment". On Vercel, on-demand revalidation is only as good as the cache it clears: with the in-memory default, a cold instance would refetch from the CMS anyway, and durable storage needs `'use cache: remote'` or a cache handler, which the docs say "requires a network roundtrip … and typically incurs platform fees". Every read this app will make is a `fetch`, so the Data Cache covers all of it with tags, and the model needs no new storage. `unstable_cache` exists for data that is not fetched; here nothing will be, and the docs mark it as replaced by `'use cache'` in Next.js 16, so it has no work to do.

## Considered options

- **Cache Components with `'use cache'`, `cacheLife` and `cacheTag`.** The default in new apps and the direction of the framework. Rejected for now: durable storage would cost a remote cache, and the route segment `revalidate` that this app's ISR interval relies on is replaced by `cacheLife` under Cache Components. It would also change rendering (a prerendered shell with streamed dynamic holes, `<Suspense>` around `params`) for no gain on pages that are fully static between revalidations.
- **`unstable_cache` around the data layer.** Rejected: every read will be a `fetch`, which the Data Cache already tags, and the API is superseded in 16.

## Consequences

- `fetch` is not cached by default in 16, so every CMS read opts in explicitly with `cache: 'force-cache'` and its tags; a read that does not is outside the Data Cache, and no tag can clear it.
- `revalidateTag` takes a profile as its second argument in 16, and calling it without one is deprecated. The revalidate route must choose the profile deliberately (`'max'` serves stale content while the refetch runs; `{ expire: 0 }` makes the next request wait for fresh data), and that choice will be recorded with the route.
- The revalidate route lives at `/api/revalidate/`, with the slash, because `trailingSlash: true` answers the slashless path with a 308, and the revalidation request should not depend on the CMS's HTTP client following a redirect with its POST body; the plugin therefore posts to `/api/revalidate/`. A slashless POST gets the 308, which the plugin does not follow, so no revalidation would happen. The plugin and the contract text moved to the slashed path in their own contract pull request, separate from this one, which lands before it.
- Moving to Cache Components later is a contained change: the docs' migration guide maps each `fetch` option to `'use cache'`, `cacheLife` and `cacheTag`, and `revalidateTag` keeps working.
- [ADR 0023](0023-next-data-cache-is-the-only-http-cache.md) relies on this: the Data Cache is the only HTTP cache for REST responses, and it is the one the revalidate route can clear.
