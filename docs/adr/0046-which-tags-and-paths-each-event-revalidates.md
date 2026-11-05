---
status: accepted
date: 2026-11-05
---

# Which tags and paths each event revalidates, and which tags each fetch carries

On-demand revalidation works only if the tags the revalidate route clears are the tags the data layer put on its fetches. [ADR 0043](0043-fetch-cache-with-tags-without-cache-components.md) chose the `fetch` Data Cache with tags; this records the tags, which fetch carries which, and what each event clears. The rules are code in `apps/web/lib/tags.ts` (`eventsToInvalidations` and the fetch-tag functions), and a unit test holds them to the coverage rule below.

## The tags

`resources`, `terms`, `resource:{slug}`, `topic:{slug}` and `type:{slug}`.

## The union rule

Every event invalidates the union of what its current state and its `previous` state imply ([ADRs 0014](0014-one-php-request-is-one-batch.md), [0016](0016-previous-state-on-update.md)), and the route never diffs the two.

- **A resource event** clears `resources`, `resource:{slug}`, `type:{t}` and each `topic:{p}`, and the paths `/resources/`, the resource's page, its type listing, each topic listing and each type-plus-topic listing, for both states. Refresh (`publish`, `update`) and remove (`unpublish`, `trash`, `delete`) clear the same things; the refetch decides what is shown.
- **A term event** clears `resources`, `terms` and `topic:{slug}` or `type:{slug}` for the current and previous slug, and the paths `/resources/` and the term's own listing for each slug.

## Pagination is covered by tags only

`…/page/{n}/` is never revalidated as a path: an event cannot say how many pages a listing has, and every page of a listing fetches with the same tags as its first page, so clearing the tags clears every page. The paths the route revalidates are the first pages, which also returns a useful list to the editor ([ADR 0018](0018-revalidation-results-shown-in-the-editor.md)).

## The `terms` tag

A term rename changes the name shown on every page that shows the term: the library and every listing, every resource page, and the filter bar. The event names the term, not those pages. `terms` is produced by term events only and carried by every fetch that embeds or lists terms (every `_embed` list and every resource fetch), so a term event reaches all of them and a resource event reaches none it does not concern. Term events keep `resources` too, because the resolve route answers with the resource's type slug and a type rename changes it.

## The canonical slug form

A slug goes into a path or tag in one form: existing percent escapes kept with lower-case hex, and every character a path segment does not allow (`?`, `#`, a bare `%`, a backslash, any non-ASCII character) percent-encoded as UTF-8 in lower case. Nothing is decoded. `canonicalSlug` in `lib/routes.ts` does it, after validating, and every path and tag builder calls it, so `日`, `%E6%97%A5` and `%e6%97%a5` give one tag. Lower case because it is WordPress's own form: `sanitize_title` lower-cases a title and percent-encodes its non-ASCII bytes in lower case, so slugs from REST and from events pass through unchanged. The result is printable ASCII, which Next.js's `encodeHeaderSafe` leaves alone; a raw tag would have been encoded in upper case and never matched WordPress's slug. Every slug WordPress stores is at most 200 characters in this form, so tags stay under Next.js's 256-character limit.

The slug rule itself (`slugProblem` in `lib/routes.ts`) is the one the Zod schemas use, so `eventsToInvalidations` never throws on a body the route accepted. On an event that is type-correct but schema-invalid, such as a lone surrogate, it throws a `RangeError` rather than return a partial result.

## The data-layer tagging rule

Tags are fixed before the request, from the URL and its parameters, never from the response, so a miss is cached under the tags that a later publish clears. A parameter the predicates reject (`isSlug`, `isTypeSlug`, `parsePageSegment`) is `notFound()`, never a throw and never a fetch.

| Fetch | Tags | Reason |
|---|---|---|
| Library listing, every page | `resources`, `terms` | Every resource event can change it; it embeds terms. |
| Type listing, every page | `type:{t}`, `terms` | Resource events in or leaving type `t`, and type events on `t`. |
| Topic listing, every page | `topic:{p}`, `terms` | Resource events in or leaving topic `p`, and topic events on `p`. |
| Type-plus-topic listing, every page | `type:{t}`, `topic:{p}`, `terms` | Either term's events, and resource events touching either. |
| Resource by slug, a miss included | `resource:{slug}`, `type:{typeSegmentFromUrl}`, `terms` | A publish under the slug clears a cached miss; a type event clears the pages under that segment so they redirect or 404; it embeds terms. |
| Term lookup by slug, a miss included | `topic:{slug}` or `type:{slug}` | A term event for the slug, a `create` included, clears it. |
| Resolve | `resources` | Any resource event may add or move an old slug; a type event changes the type it answers with. |
| Taxonomy lists for the filter bar | `terms` | Only term events change them. |

The coverage rule the test encodes: for a sample of resource states, every listing a resource appears on, and its own page, shares at least one tag with the invalidations of any event on that resource, as its current or its previous state; and every page that shows a term shares one with any term event.

## Considered options

- **Tag every fetch `resources` and let term events clear that.** Term events would reach every page, but so would every resource event, which would make the per-resource and per-term tags pointless. Rejected for `terms`.
- **Enumerate paginated paths.** The event cannot know the page count, and fetching it to find out would put a CMS request in the revalidate route. Rejected for tags.
- **Upper-case hex, RFC 3986's normal form.** It matches `encodeHeaderSafe`, but every WordPress slug would need re-encoding and a slug compared against the CMS's would differ. Rejected.
- **Tag a resource fetch from its response (its actual type and topics).** A miss has no response to tag from, and a cached miss would then outlive the publish that should clear it. Rejected.

## Consequences

- The data layer must call the fetch-tag functions in `lib/tags.ts` rather than build tags by hand.
- The related block's fetches are an `_embed` list and carry `topic:{p}` and `terms`. A pick from another topic changes without clearing them, so its card refreshes with the page holding the block or at the ISR interval; record that with the block's component if it needs more.
- The shared package's README still lists four tags; `terms` is the front end's own and changes nothing the CMS sends.
