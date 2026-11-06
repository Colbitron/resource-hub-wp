---
status: accepted
date: 2026-11-04
merges: 0035 (2026-11-06); rewritten 2026-11-06 for the mechanism on main
---

# A permanent redirect is computed, single-hop, and never one a browser may keep

Type paths (ADR 0024) mean a resource's URL changes when its type changes, and a type can change back. A webinar re-typed as a podcast and then back again is the case that breaks naive redirects: with a stored redirect table and header-less 301s, browsers keep the first redirect and loop. Google also asks for a permanent redirect only when it will not be reverted, and a type that changes back reverts one. An old slug is the same problem: the slug is the identity, and a renamed resource's old URL must lead to its new one without a table to keep.

**The decision.** Every redirect is computed from the CMS's current state, never stored as a rule: a 308 to the canonical URL, which always answers 200, in a single hop, carrying a cache header that keeps a browser from holding it. The slug is looked up first; the CMS's resolve route is asked only on a miss, so renamed resources cost one extra request and current ones none. The CMS sends readers no redirects at all (ADR 0031).

Redirects decidable from the path alone come from `proxy.ts` with `no-store`; redirects that need data come from the ISR pages, stored and cleared by the event that makes them wrong, with the `headers()` rule in `next.config.ts` keeping browsers asking. How each kind is sent is in [`caching.md`, Redirects](../architecture/caching.md#redirects); the browser tests and measurements behind this record are in its [Lab notes](../architecture/caching.md#lab-notes).

The first version of this record required `no-store` on every permanent redirect. It was replaced on 2026-11-06 by the purpose behind it, for what a per-request page costs on Vercel, listed under Considered options.

## Considered options

- **A stored redirect table with plain 301s.** Rejected: the loop above.
- **A per-request render that sends every redirect with `no-store`.** The contract-literal choice, measured and built first. Reversed: a function invocation and a cold start on every view, no CDN-cacheable HTML, and one uncached resolve request per page view for every unknown slug, to buy something ISR plus the union rule and the `headers()` rule buy anyway.
- **`proxy.ts` with the data layer.** Rejected: its `fetch` is not the Data Cache's, so a CMS request per page view.
- **A Route Handler at the resource path.** Rejected: cannot share a segment with the page.
- **Cache Components with the decision in the dynamic part.** Rejected by ADR 0043, and a redirect after the static shell is flushed is a meta refresh.

## Consequences

- Rule for both sides: never send a permanent redirect without a cache header, for any redirect whose target can change. Next.js's own trailing-slash 308 carries none and is exempt, because `/path` to `/path/` never changes; a slashless non-canonical path takes two hops.
- A redirect's target is a fixed point: it is built from canonical segments, so following it never redirects again. Unit tests check that over generated slugs and paths, and a Playwright round trip follows a type change and its reversal with every hop from the server.
- `proxy.ts` must stay free of the data layer and of anything that varies with the CMS.
- The decision in an ISR page runs before streaming begins and outside any Suspense boundary or `loading.tsx`, and the route uses no request-time API, or the redirect is a 200 with a meta refresh or a runtime 500.
