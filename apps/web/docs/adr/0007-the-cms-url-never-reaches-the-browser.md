---
status: accepted
date: 2026-11-04
---

# The CMS URL never reaches the browser

The front end is the only public site; the CMS's theme pages answer anonymous visitors with a 404 (WordPress side, ADR 0031). WordPress still emits its own absolute URLs everywhere: `get_permalink()`, links and images in `content.rendered`, and media URLs under `_embed`. Left alone, any of them would put the CMS's address in a page's HTML or in a browser's network requests. We keep it out in three ways.

- **Every CMS request happens on the Next.js server.** `WP_API_URL` is a server-only environment variable, never `NEXT_PUBLIC_`, and the data layer in `lib/wp/` runs only in Server Components and route handlers; `next.config.ts` reads the CMS origin for the rewrite below. No client component fetches from the CMS.
- **Images are served through a rewrite.** `next.config.ts` rewrites `/media/:path*` to the CMS's uploads directory, so an image's URL in the browser is `/media/…` on this site, and the Vercel image optimizer's source is same-origin ([ADR 0006](0006-vercel-image-optimizer.md)).
- **Rendered HTML is rewritten in one pass.** `<img src>` and `srcset` in `content.rendered` become `/media/…` in the same server-side parse pass that swaps the block marker ([ADR 0004](0004-block-marker-swapped-for-a-server-component.md)) and strips the CMS domain from links ([ADR 0003](0003-cms-links-are-made-relative.md)). Featured images from `_embed` get the same rewrite before they reach `next/image`.

This is recorded as reducing exposure, not as security. Anyone who finds the CMS's address can still reach its REST API, which is public by design because this app reads it anonymously. What the rewrite buys is that the address is not handed out: not in HTML, not in image requests, not in a client bundle. If that ever needs to be a boundary rather than a habit, a possible later hardening is a Cloudflare rule in front of the CMS that admits only requests carrying a secret header, which this app's server-side requests would send.

## Considered options

- **Point the browser at the CMS for images and leave links as they are.** Simplest. Rejected: the CMS's address would be in every page, and readers who followed a CMS link would reach a 404.
- **Rewrite URLs in WordPress before they leave the CMS.** Rejected: WordPress would need to know the front end's media path and rewrite every URL it emits, including in editor-typed HTML, and its previews would break; rewriting where the HTML is rendered keeps the rule in one place.

## Consequences

- One parse pass owns every rewrite in `content.rendered`: links, images and the block marker. A new kind of CMS URL in the body (a video, a file link) is a change to that pass.
- `/media/` is part of the contract with the CMS: it maps to the uploads directory one to one, so a path under `wp-content/uploads/` is the same path under `/media/`.
- The uploads directory stays publicly reachable on the CMS, because the rewrite and the image optimizer fetch from it; it is served by the web server, not by WordPress's theme.
