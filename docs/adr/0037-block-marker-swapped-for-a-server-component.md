---
status: accepted
date: 2026-11-04
---

# The related-resources block's marker is swapped for a server component

The CMS's `resource-hub/related-resources` block renders the same thing everywhere: `<div data-rh-block="related-resources" data-count="…" data-topic="…" data-topic-id="…" data-exclude="…">` around an `<h2>` heading and a fallback `<ul>` of links ([ADR 0026](0026-block-renders-a-marker-with-a-fallback.md)). Rendered as is, that list would be baked into each resource page and go stale whenever another resource in the topic is published, because nothing revalidates the page that embeds it. The front end parses `content.rendered` with `html-react-parser`'s `replace` on the server and swaps the wrapper for its own `<RelatedResources>` server component, fetched with the `topic:{slug}` tag, so the list is revalidated by the same events as every other topic listing.

## Consequences

- `data-rh-block`, `data-count`, `data-topic`, `data-topic-id`, `data-exclude` and the heading are part of the contract. `data-topic` is the topic's current slug, resolved by the CMS at render time, and names the `topic:{slug}` tag; `data-topic-id` is the term ID the component passes as `resource_topic` to `/wp/v2/resources`, since the core collection filters by ID, not slug; `data-exclude` is the ID of the post the block sits in, which the list leaves out.
- The marker is read on the Next.js server only and never reaches the browser, so its IDs and the CMS data behind them stay server-side ([ADR 0040](0040-the-cms-url-never-reaches-the-browser.md)).
- The component uses the shared class names and styles ([ADR 0038](0038-shared-styles-through-npm-rc.md)), so the fallback and the swap look the same.
- No client JavaScript: the swap happens on the server.
