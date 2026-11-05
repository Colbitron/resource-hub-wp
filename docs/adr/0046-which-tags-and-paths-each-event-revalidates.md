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

A term rename changes the name shown on every page that shows the term: the library and every listing, every resource page, and the filter bar. The event names the term, not those pages. `terms` is produced by term events only and carried by every fetch that embeds or lists terms (every `_embed` list and every resource fetch), so a term event reaches all of them, and a resource event reaches none of them through `terms`. Term events keep `resources` too, because the resolve route answers with the resource's type slug and a type rename changes it.

## The canonical slug form

A slug goes into a path or tag in one form: existing percent escapes kept, every character a path segment does not allow (`?`, `#`, a bare `%`, a backslash, any non-ASCII character) percent-encoded as UTF-8, and the whole result lower-cased, the hex and the ASCII letters alike. Nothing is decoded. `canonicalSlug` in `lib/routes.ts` does it, after validating, and every path and tag builder calls it, so `日`, `%E6%97%A5` and `%e6%97%a5` give one tag, and so do `ABC` and `abc`. Lower case because it is WordPress's own form: `sanitize_title` lower-cases a title and percent-encodes its non-ASCII bytes in lower case, so slugs from REST and from events pass through unchanged. Because the form is lower case, the reserved type slugs are checked in any case: `Topic` is rejected as a type slug, since it would become the `topic` segment. The result is printable ASCII, which Next.js's `encodeHeaderSafe` leaves alone; a raw tag would have been encoded in upper case and never matched WordPress's slug.

The length cap counts this form. The shared schema caps a slug at 200 code points, but a raw slug of 200 `日` is 1,800 characters encoded, and Next.js drops a tag longer than 256 characters with only a warning, so its pages would never be revalidated. `slugProblem` therefore also rejects a slug whose canonical form is longer than 200 characters. WordPress cannot store one: `post_name` and the term `slug` column are 200 characters wide and hold the encoded form. The longest tag is then `resource:` and 200 characters, 209 in all.

The slug rule itself (`slugProblem` in `lib/routes.ts`) is the one the Zod schemas use, so `eventsToInvalidations` never throws on a body the route accepted. That makes the front end's readers stricter than the JSON Schema in three documented ways (the comment on `slugSchema` in `lib/wp/schemas/common.ts`): a lone surrogate, a dot segment, and a canonical form over 200 characters, none of which WordPress can store or a path can carry. On an event that is type-correct but schema-invalid, such as a lone surrogate, it throws a `RangeError` rather than return a partial result.

## The data-layer tagging rule

Tags are fixed before the request, from the URL and its parameters, never from the response, so a miss is cached under the tags that a later publish clears. A parameter the predicates reject (`isSlug`, `isTypeSlug`, `parsePageSegment`) is `notFound()`, never a throw and never a fetch.

Tags are fixed from the request, but Next.js keys a cached fetch by its URL, method and headers, not by its tags, so two pages that fetch one URL share one entry, stored under the tags of whichever fetched first. The rule therefore relies only on tags that every caller of a URL would add. A tag that depends on the calling page, such as the type segment a resource page was reached under, is not put on a fetch whose URL does not contain it.

| Fetch | Tags | Reason |
|---|---|---|
| Library listing, every page | `resources`, `terms` | Every resource event can change it; it embeds terms. |
| Type listing, every page | `type:{t}`, `terms` | Resource events in or leaving type `t`, and type events on `t`. |
| Topic listing, every page | `topic:{p}`, `terms` | Resource events in or leaving topic `p`, and topic events on `p`. |
| Type-plus-topic listing, every page | `type:{t}`, `topic:{p}`, `terms` | Either term's events, and resource events touching either. |
| Resource by slug, a miss included | `resource:{slug}`, `terms` | A publish under the slug clears a cached miss; it embeds terms, so a type rename also reaches the pages under the old segment, which then redirect or 404. No type tag: the URL has no type in it (see above). |
| Resource by ID, a miss included | `resources`, `terms` | The URL names no slug and tags are fixed before the request, so `resource:{slug}` is not available, and no tag names an ID; `resources` reaches every event on the resource, whatever its slug. It embeds terms. |
| Related-resources block, by topic | `topic:{p}`, `terms` | It is a topic list with `exclude` and a count, so the same events as the topic listing clear it ([ADR 0037](0037-block-marker-swapped-for-a-server-component.md)). |
| Related section: the related route, and the `include={ids}` read of its items | `resources`, `terms`, `resource:{hostSlug}` | A pick from any topic may be published, unpublished, trashed or renamed, and the topics the route merges by may change, so any resource event may change it; the read embeds terms. `resource:{hostSlug}` names the host page but is not relied on: two hosts with the same items share one `include=` URL. |
| Flag-filtered list (featured) | `resources`, `terms` | Any resource event may add a resource to it or take one away, and flags send no term events; it embeds terms. |
| Term lookup by slug, a miss included | `topic:{slug}` or `type:{slug}` | A term event for the slug, a `create` included, clears it. |
| Flag lookup by slug (`featured`), a miss included | `resources` | Flags send no term events, so no term tag reaches it; a flag matters only once a resource carries it, and assigning it sends a resource event, which clears `resources`. |
| Resolve | `resources` | Any resource event may add or move an old slug; a type event changes the type it answers with. |
| Taxonomy lists for the filter bar | `resources`, `terms` | Term events change names and slugs; WordPress updates each term's `count` on every publish, trash and term assignment, with no term event. |

The coverage rule the test encodes: for a sample of resource states, every fetch whose result shows the resource (every listing it appears on, its own page by slug and by ID, the block for each of its topics, the related section of any page, the featured list, resolve, the flag lookup and the filter bar's term lists) shares at least one tag with the invalidations of any event on that resource, as its current or its previous state; and every fetch that shows a term shares one with any term event. The test writes each fetch's tags out by hand from this table and checks the functions in `lib/tags.ts` against them, so the rule is not proved with the code it checks.

## Considered options

- **Tag every fetch `resources` and let term events clear that.** Term events would reach every page, but so would every resource event, which would make the per-resource and per-term tags pointless. Rejected for `terms`.
- **Enumerate paginated paths.** The event cannot know the page count, and fetching it to find out would put a CMS request in the revalidate route. Rejected for tags.
- **Upper-case hex, RFC 3986's normal form.** It matches `encodeHeaderSafe`, but every WordPress slug would need re-encoding and a slug compared against the CMS's would differ. Rejected.
- **Tag a resource fetch from its response (its actual type and topics).** A miss has no response to tag from, and a cached miss would then outlive the publish that should clear it. Rejected.
- **Tag a resource fetch with the URL's type segment.** It was meant to let a type event clear the pages under that segment, but the fetch is shared by every type segment the slug is reached under, so the tag is whichever page cached it first. `terms` reaches those pages instead. Rejected.
- **Tag the related section with its picks' own tags.** The picks are known only from the related route's response, and tags never come from a response. Rejected for `resources`, at the cost of the section refetching on every resource event.

## Consequences

- The data layer must call the fetch-tag functions in `lib/tags.ts` rather than build tags by hand.
- Every resource event clears the related section of every resource page, the featured list and the filter bar's term lists. They are small reads, and their freshness was the point.
- The shared package's README still lists four tags; `terms` is the front end's own and changes nothing the CMS sends.
