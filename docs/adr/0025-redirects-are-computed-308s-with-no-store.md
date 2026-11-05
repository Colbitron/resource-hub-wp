---
status: accepted
date: 2026-11-04
---

# A permanent redirect is computed, single-hop, and sent with `Cache-Control: no-store`

Type paths ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)) mean a resource's URL changes when its type changes, and a type can change back. A webinar re-typed as a podcast and then back again is the case that breaks naive redirects: with a manual redirect table and header-less 301s, browsers keep the first redirect and loop. Every redirect here is computed from the current state rather than stored: a 308 to the canonical URL, which always answers 200, in a single hop, sent with `Cache-Control: no-store`. The old path is revalidated too, so the edge cache does not keep serving it.

These redirects are the front end's: its type-mismatch redirect and its old-slug redirect ([ADR 0029](0029-old-slugs-resolve-through-core.md)). The CMS sends readers no redirects at all; its theme pages answer anonymous visitors with a 404 ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)).

The evidence, gathered 2026-11-04 with a Playwright test across Chromium 156, Firefox 157 and WebKit 27.2: Chromium caches a header-less 308 indefinitely and fails webinar → podcast → webinar with `ERR_TOO_MANY_REDIRECTS`. With `no-store`, `no-cache` or a `max-age`, all three engines asked the server again. The engine source agrees: Chromium's `GetFreshnessLifetimes` gives 301 and 308 `TimeDelta::Max()` unless a header overrules it; Firefox gives 0 heuristic freshness without `Last-Modified`; WebKit gives a 301 365 days and a 308 zero, and drops redirects marked `no-store`, `no-cache` or `must-revalidate`. Google's guidance agrees from the other side, asking for permanent redirects only "when you're sure that the redirect won't be reverted".

## Considered options

- **A stored redirect table with plain 301s.** Rejected: the loop above.

## Consequences

- Rule for the CMS and the front end alike: never send a permanent redirect without a cache header. The CMS sends anonymous visitors no redirects ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)), so the front end's are the ones in scope; the rule covers any redirect either side adds.
- A Playwright round-trip test on the front end changes a type, changes it back, and follows both URLs.
- Old slugs resolve the same way, through the resolve route ([ADR 0029](0029-old-slugs-resolve-through-core.md)), with the front end sending the 308.
