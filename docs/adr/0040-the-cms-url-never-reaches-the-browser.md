---
status: accepted
date: 2026-11-04
---

# The CMS URL never reaches the browser

The front end is the only public site; the CMS's theme pages answer anonymous visitors with a 404 (ADR 0031). WordPress still emits its own absolute URLs everywhere: `get_permalink()`, links and images in `content.rendered`, media URLs under `_embed`. Left alone, any of them would put the CMS's address in a page's HTML or in a browser's network requests. We keep it out in three ways.

- **Every CMS request happens on the Next.js server.** `WP_API_URL` is a server-only environment variable, never `NEXT_PUBLIC_`; the data layer runs only in Server Components and route handlers; no client component fetches from the CMS.
- **Images are served through a rewrite.** `next.config.ts` rewrites `/media/:path*` to the CMS's uploads directory, one to one, so an image's URL in the browser is `/media/…` on this site and the image optimizer's source is same-origin.
- **Rendered HTML is rewritten in one pass.** Links lose the CMS domain and `<img src>` and `srcset` become `/media/…` in the same server-side parse pass that swaps the block marker; featured images from `_embed` get the same rewrite before they reach `next/image`.

This is recorded as reducing exposure, not as security. Anyone who finds the CMS's address can still reach its REST API, which is public by design because this app reads it anonymously. What the rewrite buys is that the address is not handed out: not in HTML, not in image requests, not in a client bundle. If that ever needs to be a boundary, the hardening not adopted is a Cloudflare rule in front of the CMS that admits only requests carrying a secret header this app's server-side requests would send.

## Considered options

- **Point the browser at the CMS for images and leave links as they are.** Rejected: the CMS's address in every page, and readers who followed a CMS link would reach a 404.
- **Rewrite URLs in WordPress before they leave the CMS.** Rejected: WordPress would need to know the front end's media path and rewrite every URL it emits, editor-typed HTML included, and its previews would break; rewriting where the HTML is rendered keeps the rule in one place.

## Consequences

- One parse pass owns every rewrite in `content.rendered`: links, images and the block marker. A new kind of CMS URL in a body is a change to that pass (`apps/web/lib/content/render.tsx`, whose docblock holds the rules).
- `/media/` is part of the contract with the CMS: a path under `wp-content/uploads/` is the same path under `/media/`. The uploads directory stays publicly reachable on the CMS.
- The `/media/` rewrite is a proxy that passes the CMS's response headers through, four of which name or fingerprint the CMS on a direct request. The alternative, a Route Handler that copies an allow-list of headers at the cost of a function invocation per uncached media request, is open in issue #52.
