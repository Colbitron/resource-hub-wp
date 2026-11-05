---
status: accepted
date: 2026-11-04
---

# Old slugs resolve through core's `_wp_old_slug` data, via a resolve route

Renaming a published resource's slug breaks every link to the old URL. WordPress already records old slugs in `_wp_old_slug` post meta and redirects them on its own front end, but our readers are on the front end, not the CMS. We add `GET /resource-hub/v1/resolve?slug=…`. It sets the `name` query var, calls core's private `_find_post_by_old_slug( 'resource' )`, restores the query var, and checks that the result is a published resource, answering with its id, current type and current slug, or a 404. The front end looks up the current slug first, calls resolve only on a miss, and sends a 308 with `no-store` to the canonical URL ([ADR 0025](0025-redirects-are-computed-308s-with-no-store.md)).

Reusing core keeps one record of slug history. Core's lookup is already salted-cached in the `post-queries` group, and reverting a slug deletes the old entry, so a rename and its undo cannot loop.

## Considered options

- **A private slug-history taxonomy.** Rejected: it duplicates what core already stores.
- **Let WordPress's own front end send its 301.** Rejected: Varnish caches the CMS's HTML, so a stale cached redirect could loop, and anonymous visitors never reach the CMS's theme pages anyway ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)).
- **A `meta_query` on `_wp_old_slug` with a `phpcs:ignore`.** Rejected: it silences the slow-query sniff instead of meeting it.

## Consequences

- `_find_post_by_old_slug()` is private API. The call is guarded by `function_exists()`, falling back to not found, and a PHPUnit test fails if core changes the function's behaviour.
- Core's query is not status-filtered and has no newest-first tie-break, so the route checks the status itself; when two resources once shared a slug, the match is core's.
- Core's query returns a single match (`get_var`, no `ORDER BY`, no status filter), and the route accepts it. So when an unpublished resource and a published one both once had a slug, the unpublished one can be the match, and the slug is a 404 although a published resource had it. No fix exists without a meta query, which the third rejected option rules out; a PHPUnit test pins today's behaviour so a change in core shows up.
- The response is `resolve-response.schema.json` in `packages/ui` ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)).
- Settled 2026-11-05, when the route was built: the current slug is looked up first (a `WP_Query` on `name`, published only) and old slugs only on a miss, so a slug that is one resource's current name and another's old one resolves to the current holder. `slug` is capped at 200 bytes as sent, before `sanitize_title()`, so an ASCII slug, which that function never lengthens, is looked up whole or refused, never shortened. The cap does not prevent every cut: `sanitize_title()` percent-encodes each non-ASCII byte as three characters, so a 3-byte CJK character becomes nine, and keeps only the whole encoded characters that fit in 200, so a CJK slug ends at 198 characters, and two long non-ASCII slugs that differ only past the cut look up the same slug. That is harmless, because WordPress cuts a stored `post_name` the same way on save, so the lookup matches what is stored, and the front end redirects to the canonical slug the route returns. A resource without exactly one type, or with a reserved type slug, is a 404: the schema would reject the body for the first, and for `topic` or `page` literally; a percent-encoded form of either is refused by the plugin's own stricter rule from ADR 0024. The route clears the `year`, `monthnum` and `day` query vars for the call as well as setting `name`, because core narrows the lookup by them when set. Afterwards it restores them exactly, removing any that were absent before. A lookup that returns anything but a positive ID is a miss, checked before `get_post()`, which reads 0 as the global post. When `_find_post_by_old_slug()` is missing there is no fallback lookup: the only public alternative is a `WP_Query` on `meta_key`/`meta_value`, which the VIP slow-query sniff flags, and the third rejected option above already covers silencing it.
