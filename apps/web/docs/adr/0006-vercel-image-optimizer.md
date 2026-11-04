---
status: accepted
date: 2026-11-04
---

# Images go through Vercel's image optimizer

Resource images are uploaded to WordPress and served from the CMS host. `next/image` with Vercel's image optimizer resizes them per device and serves modern formats, and the Vercel plan already includes 5,000 optimized images a month. We keep the optimizer.

## Considered options

- **Proxy the originals and WordPress's generated sizes through Cloudflare, with no transformations.** The fallback if the optimizer's quota or cost ever becomes a problem: WordPress already generates several sizes, and Cloudflare already sits in front of the CMS.

## Consequences

- Image sources are same-origin `/media/…` paths, rewritten to the CMS's uploads directory ([ADR 0007](0007-the-cms-url-never-reaches-the-browser.md)), so the CMS host is not listed in `images.remotePatterns`; if `images.localPatterns` is set, it must allow `/media/**`.
- Every image has a width and height, so late images cause no layout shift.
- Optimized-image usage is the number to watch against the plan's monthly allowance.
