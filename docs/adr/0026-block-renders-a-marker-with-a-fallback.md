---
status: accepted
date: 2026-11-04
---

# The related-resources block renders a marker the front end swaps, around a plain fallback list

A block's server render is baked into `content.rendered`, and the front end caches each resource page by its own tags. A related list rendered into one resource's body would go stale whenever another resource in that topic is published, because nothing revalidates the page that embeds it. The render callback therefore always outputs the same thing: a wrapper `<div data-rh-block="related-resources" data-count="3" data-topic="topic-slug" data-topic-id="45" data-exclude="123">` around its `<h2>` heading and a fallback `<ul>` of links. Each attribute has one consumer: `data-topic` is the term's current slug, for the `topic:{slug}` cache tag; `data-topic-id` is the term ID, for the `resource_topic` filter on `GET /wp/v2/resources`; `data-exclude` is the ID of the post the block sits in, which the list leaves out; `data-count` is how many to show. The front end parses `content.rendered` with `html-react-parser`'s `replace` on the Next.js server and swaps the wrapper for its own `<RelatedResources>` server component, fetched with `topic:{slug}` tags, so the list is revalidated by topic events like every other listing. The marker is read on the server only and never reaches the browser; the same parse pass strips the CMS domain from links and rewrites body images to `/media/` ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)).

The block stays server-rendered with a PHP `render_callback`, so the editor preview, the CMS's own pages and any reader without the swap see a working list, and the front end gets a stable, documented hook to replace.

## Considered options

- **Use the server-rendered HTML as is on the front end.** Rejected: the staleness above.
- **A React-rendered block with no server output.** Rejected: the same HTML would no longer serve the editor preview and the CMS's own pages, which is why CLAUDE.md asked for a server render in the first place.

## Consequences

- `data-rh-block` and its `data-` attributes are part of the contract, alongside the shared class names ([ADR 0028](0028-shared-styles-in-a-private-github-package.md)).
- Carrying both the slug and the ID costs one attribute and saves the front end a term lookup per block: the slug alone cannot filter the core collection, and the ID alone cannot name the cache tag.
- The attributes the marker carries are [ADR 0027](0027-block-requires-a-topic.md).
- No shared JavaScript: the swap is a front-end concern and the fallback needs none.
