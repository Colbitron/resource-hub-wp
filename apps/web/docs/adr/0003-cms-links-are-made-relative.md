---
status: accepted
date: 2026-11-04
---

# The front end strips the CMS domain from every link in the HTML it renders

Resource bodies arrive as `content.rendered`, and every link in them that points at the site (editor-typed links, the block's fallback list) is an absolute CMS URL from `get_permalink()`. Because the paths are mirrored on both sites (WordPress side, ADR 0024), the CMS URL and the front-end URL differ only by host. While rendering, on the server, the front end strips the CMS domain from every link in that HTML, so the links become site-relative and stay on the front end. WordPress keeps `get_permalink()` absolute and does no rewriting. The same parse pass rewrites images to `/media/…` and swaps the block marker ([ADR 0007](0007-the-cms-url-never-reaches-the-browser.md), [ADR 0004](0004-block-marker-swapped-for-a-server-component.md)).

## Consequences

- One rule covers every link, whoever wrote it; no link needs a field of its own.
- The CMS does not redirect readers here. Its theme pages answer anonymous visitors with a 404 (WordPress side, ADR 0031), so a CMS link that escaped the rewrite would lead nowhere; every link in rendered HTML has to go through this pass.
- The block's fallback links are covered too, though the block itself is swapped for a component ([ADR 0004](0004-block-marker-swapped-for-a-server-component.md)).
