---
status: accepted
date: 2026-11-06
---

# The front end renders the CMS's pages: the static front page at `/` and every published page at its path

Until now the front end served the library alone, and `/` was a hard-coded sentence. The owner's decision is that the front end is a portal to the CMS: `/` shows the WordPress static front page (Settings > Reading), and every other published WordPress page, hierarchy included, is served at its own path with a trailing slash by a catch-all route. Posts are never served, drafts, private and password-protected pages never, and the CMS's own theme pages stay a 404 for anonymous visitors (ADR 0031). Three things had to be settled that are hard to change afterwards.

**How the front end learns the page tree: one plugin route, by path, answering 200 for a miss.** Core REST shows anonymous readers neither `page_on_front` nor a lookup by full path. The plugin adds `GET /resource-hub/v1/page?path=…`, answering `{ "page": { "id", "path" } | null }`: the front page for `/`, else the page whose parent chain is the path, else the one published page that has the last segment as its slug now (a page moved under another parent, the same guess core makes). The answer carries the page's canonical path now, so the front end redirects when that differs, and reads the page with core's `/wp/v2/pages/{id}`. A miss is a 200 with `null`, unlike the resolve route, because the Data Cache stores only 200s and the root with no front page set, and every path a crawler tries, would otherwise reach the CMS on every request.

**One URL space: the front end's routes win, and the CMS keeps pages out of their way.** Static and dynamic routes win over a catch-all, so a top-level page slugged `resources`, `api`, `media` or `_next` could never be served. Both sides hold the same list: the front end answers such a first segment with a 404 without asking, and the plugin tells `wp_unique_post_slug()` the slug is taken, so it is saved with a suffix, the way core treats `embed` and the feed names.

**The contract: a `page` event, and one `pages` tag.** A page change is a third event shape in the batch, with the five resource event names, `id`, `path` and `previous: { path } | null` on `update`. The front end clears one tag, `pages`, carried by every page lookup and read, plus the paths named: one tag rather than one per page, because a parent's move changes the paths of every page below it, which no event names, and the site has few pages. A new event `type` is not additive (ADR 0010), so the change landed front end first.

## Considered options

- **Core's `/wp/v2/settings` or the REST index for the front page.** Rejected: the settings endpoint is for administrators and the index does not carry `page_on_front`.
- **A fixed slug for the home page.** Rejected: editors could not choose it in WordPress's own setting.
- **Returning the whole page from the plugin route.** Rejected: duplicates core's pages controller; IDs and paths only.
- **Several core requests to walk the parent chain from the front end.** Rejected: one request per level on every view, with the chain's rules outside PHPUnit.
- **A 404 for a miss.** Rejected: every view of `/` without a front page would reach the CMS. The resolve route is unchanged, since changing it is its own contract change.
- **A per-page cache tag.** Rejected: a parent move changes descendants' paths without an event for each.
- **Page changes as a new top-level key in the batch.** Rejected: the old front end would drop the key silently and record the batch as sent.
- **Refusing a reserved page slug with an error.** Rejected: a page slug is generated from the title, and core's own answer to a slug it cannot serve is a suffix.
- **A redirect from `/` to `/resources/` while no front page is set.** Rejected: a permanent redirect from the root is hard to take back. A welcome page, a 200, was chosen.

## Consequences

- The catch-all is an ISR route like the resource page, storing the page, the welcome page, a computed 308 or a 404 under `pages`, with the proxy's case redirect running first; a redirect is sent only after the target path has been looked up too and answered the same page, so two cache entries that disagree give a 404 rather than a loop. The decision is in `lib/page-request.ts` and the storage behaviour in [`docs/architecture/caching.md`](../architecture/caching.md).
- Every URL no other route claims now costs one page lookup, cached as a miss, and its 404 is decided by data (issues #46 and #48).
- Core records old slugs for non-hierarchical post types only, so a renamed page's old path is a 404; a moved page's children are found by the guess when their slugs are unique.
- The posts page is never served. A password-protected page is never served, so a password put on a page is an `unpublish` and one taken off a `publish`.
- `/wp/v2/pages` joins the routes whose anonymous responses carry the plugin's no-cache header.
