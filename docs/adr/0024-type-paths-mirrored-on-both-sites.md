---
status: accepted
date: 2026-11-04
---

# Resource URLs are `/resources/[type]/[slug]/`, mirrored on both sites, and a resource has exactly one type

A resource's path carries its type, `/resources/[type]/[slug]/` rather than `/resources/[slug]/`, for search: a subfolder per type gives the library a visible hierarchy (Ahrefs: subfolders "provide a sense of hierarchy"), with each type's hub at `/resources/[type]/` as the parent of its resources. A path segment can only hold one value, so a resource has exactly one type: validated on save, and shown in the editor as radio buttons rather than the checkbox list [ADR 0007](0007-one-post-type-with-a-type-taxonomy.md) described.

Listings filter by one topic and one type at a time, and filters and pagination are path segments, not query strings. In the Next.js App Router, reading `searchParams` makes a page dynamic, so a function runs on every hit; path segments can be prerendered. Five types plus "any" by five topics plus "any" is 36 listings, times their pages. How the front end builds those routes is [ADR 0034](0034-filters-and-pagination-are-path-segments.md).

The full route set is `/resources/`, `/resources/[type]/`, `/resources/topic/[topic]/`, `/resources/[type]/topic/[topic]/` and `/resources/[type]/[slug]/`, and every listing paginates as `…/page/[n]/`. `topic` and `page` are therefore reserved and can never be a type slug. WordPress refuses either as a `resource_type` slug, on create and on edit, with an admin error message that says the slug is reserved, so a bad type never reaches a payload the schema would reject. That covers a slug generated from a name too: a type named "Topic" is refused rather than saved as `topic`.

The same paths exist on both sites. The post type's rewrite slug is `resources/%resource_type%`, using the rewrite tag core registers for the taxonomy, with a `post_type_link` filter to fill it, so `get_permalink()` returns the mirrored path on the CMS domain and stays absolute. The front end strips the CMS domain from every link in the HTML it renders, which turns those permalinks, and the absolute CMS links editors type, into front-end links with no rewriting on this side. Both sites use a trailing slash. The CMS does not redirect readers to the front end: its theme pages answer anonymous visitors with a 404 ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)), and the mirrored paths are there so an editor's permalink and preview have the same shape as the public URL. How the front end keeps the CMS's address out of the browser, images included, is [ADR 0039](0039-vercel-image-optimizer.md) (images) and [ADR 0040](0040-the-cms-url-never-reaches-the-browser.md).

## Considered options

- **`/resources/[slug]/`.** Rejected: the single resource's URL shows no hierarchy.
- **Filters and page numbers as query strings.** Rejected: reading `searchParams` makes every listing dynamic, as above.
- **A post type per type.** Rejected in [ADR 0007](0007-one-post-type-with-a-type-taxonomy.md); type paths keep one post type.

## Consequences

- The slug is the identity and the type segment is checked: on the front end, a URL with the wrong type redirects to the canonical one ([ADR 0025](0025-redirects-are-computed-308s-with-no-store.md)).
- The one-type rule is enforced on REST saves, the block editor's only save path. Quick and Bulk Edit save outside REST: they cannot change the type, which is hidden from both and whose terms are dropped from a Bulk Edit request, and they cannot move a resource without exactly one type to published or scheduled. Quick Edit refuses the save with a message; Bulk Edit keeps that resource's status, saves the rest and names it in a notice. A resource already published or scheduled keeps its status through them, so an edit there never makes it worse. A type that resources still have cannot be deleted from the Types screen, including its bulk delete, or over REST, because a published resource without one has no path. Only WP-CLI and PHP calls, the seeder among them, check nothing, so those are not covered.
- Topics are managed by editors, so the number of prerendered listings grows with them.
- Changing the permalink structure needs a rewrite flush on the host, and activation does not run on a deploy where the plugin is already active, so the deploy job gains a `wp rewrite flush` after activating the plugin, in the same slice as the permalink change.
- The revalidation payload carries the old type and slug on `update` ([ADR 0016](0016-previous-state-on-update.md)), so the front end can clear the path a resource left.
- The schemas also reject `topic` and `page` wherever a type slug appears ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)); WordPress's refusal is the first line, the schema the check that the two sides agree.
