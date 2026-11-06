---
status: accepted
date: 2026-11-04
merges: 0034 (2026-11-06)
---

# Resource URLs are `/resources/[type]/[slug]/` on both sites, a resource has exactly one type, and filters are path segments

A resource's path carries its type, `/resources/[type]/[slug]/`, for search: a subfolder per type gives the library a visible hierarchy, with each type's hub at `/resources/[type]/` as the parent of its resources. A path segment holds one value, so a resource has exactly one type, validated on save and chosen with radio buttons in the editor.

Listings filter by one topic and one type at a time, and filters and pagination are path segments, never query strings: `/resources/`, `/resources/[type]/`, `/resources/topic/[topic]/`, `/resources/[type]/topic/[topic]/` and `…/page/[n]/` on every listing. In the App Router, reading `searchParams` makes a page dynamic, so nothing is prerendered or served from the route cache; path segments can be prerendered and revalidated by tag. One topic and one type at a time keeps the set of listings finite: five types plus "any" by five topics plus "any" is 36 listings, times their pages, growing with the topics editors add.

`topic` and `page` are therefore reserved and can never be a type slug. WordPress refuses either as a `resource_type` slug on create and edit, and the shared schemas reject them wherever a type slug appears.

The same paths exist on both sites. The post type's rewrite slug is `resources/%resource_type%` with a `post_type_link` filter, so `get_permalink()` returns the mirrored path on the CMS domain and stays absolute; the front end strips the CMS domain from every link in the HTML it renders. Both sites use a trailing slash. The mirrored paths are there so an editor's permalink and preview have the same shape as the public URL; the CMS redirects no one (ADR 0031).

## Considered options

- **`/resources/[slug]/`.** Rejected: no hierarchy in the URL.
- **Filters and page numbers as query strings.** Rejected: every listing becomes dynamic.
- **Several topics or types at once.** Rejected: the combinations multiply past what can be prerendered.
- **A post type per type.** Rejected in ADR 0007.
- **Repairing slugs that hold a decodable escape automatically, in an upgrade routine.** Rejected: it would save content on a deploy nobody is watching. `wp resource-hub decode-slugs` is run by hand instead.
- **Rejecting such slugs with an error.** Rejected: the editor meant the decoded character, so the save decodes it.
- **A global `sanitize_title` filter.** Rejected: it would change every post type and taxonomy on the site.

## Consequences

- The slug is the identity and the type segment is checked: a URL with the wrong type redirects to the canonical one (ADR 0025).
- The one-type rule is enforced on the save paths the editor uses and the type a resource still has cannot be deleted; the unguarded paths and why are in the `OneType` docblock. The revalidation hook never sends an event whose `types` is not exactly one element, so the front end never receives an invalid state.
- Because the slug sits in the path, its stored form must be the form a URL delivers: no slug stores a percent escape of a character Next.js decodes in route params. The rule and its hooks are in the `SlugEscapes` docblock; `wp resource-hub decode-slugs` repairs slugs stored before it.
- Changing the permalink structure needs a rewrite flush on the host, which the deploy job runs.
- Type hubs carry a `type:{slug}` tag and topic listings a `topic:{slug}` tag, so a term event can invalidate them.
