---
status: accepted
date: 2026-11-04
---

# The related-resources block's marker is swapped for a server component

The CMS's `resource-hub/related-resources` block renders the same thing everywhere: `<div data-rh-block="related-resources" data-count="…" data-topic="…">` around an `<h2>` heading and a fallback `<ul>` of links (WordPress side, ADR 0026). Rendered as is, that list would be baked into each resource page and go stale whenever another resource in the topic is published, because nothing revalidates the page that embeds it. The front end parses `content.rendered` with `html-react-parser`'s `replace` and swaps the wrapper for its own `<RelatedResources>` server component, fetched with the `topic:{slug}` tag, so the list is revalidated by the same events as every other topic listing.

## Consequences

- `data-rh-block`, `data-count`, `data-topic` and the heading are part of the contract. `data-topic` is the topic's current slug, resolved by the CMS at render time.
- The component uses the shared class names and styles ([ADR 0005](0005-shared-styles-through-npm-rc.md)), so the fallback and the swap look the same.
- No client JavaScript: the swap happens on the server.
