---
status: accepted
date: 2026-11-04
---

# The front end strips the CMS domain from every link in the HTML it renders

Resource bodies arrive as `content.rendered`, and every link in them that points at the site is an absolute CMS URL: the block's fallback list builds its links with `get_permalink()`, and the links editors type or insert are absolute CMS URLs too, though they do not come from `get_permalink()`. Because the paths are mirrored on both sites ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)), the CMS URL and the front-end URL differ only by host. While rendering, on the server, the front end strips the CMS domain from every link in that HTML, so the links become site-relative and stay on the front end. WordPress keeps `get_permalink()` absolute and does no rewriting. The same parse pass rewrites images to `/media/…` and swaps the block marker ([ADR 0040](0040-the-cms-url-never-reaches-the-browser.md), [ADR 0037](0037-block-marker-swapped-for-a-server-component.md)).

## Consequences

- One rule covers every link, whoever wrote it; no link needs a field of its own.
- The CMS does not redirect readers here. Its theme pages answer anonymous visitors with a 404 ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)), so a CMS link that escaped the rewrite would lead nowhere; every link in rendered HTML has to go through this pass.
- The block's fallback links are covered too, though the block itself is swapped for a component ([ADR 0037](0037-block-marker-swapped-for-a-server-component.md)).
