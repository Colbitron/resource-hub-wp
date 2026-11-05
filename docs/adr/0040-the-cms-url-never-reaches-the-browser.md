---
status: accepted
date: 2026-11-04
---

# The CMS URL never reaches the browser

The front end is the only public site; the CMS's theme pages answer anonymous visitors with a 404 ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)). WordPress still emits its own absolute URLs everywhere: `get_permalink()`, links and images in `content.rendered`, and media URLs under `_embed`. Left alone, any of them would put the CMS's address in a page's HTML or in a browser's network requests. We keep it out in three ways.

- **Every CMS request happens on the Next.js server.** `WP_API_URL` is a server-only environment variable, never `NEXT_PUBLIC_`, and the data layer in `lib/wp/` runs only in Server Components and route handlers; `next.config.ts` reads the CMS origin for the rewrite below. No client component fetches from the CMS.
- **Images are served through a rewrite.** `next.config.ts` rewrites `/media/:path*` to the CMS's uploads directory, so an image's URL in the browser is `/media/…` on this site, and the Vercel image optimizer's source is same-origin ([ADR 0039](0039-vercel-image-optimizer.md)).
- **Rendered HTML is rewritten in one pass.** `<img src>` and `srcset` in `content.rendered` become `/media/…` in the same server-side parse pass that swaps the block marker ([ADR 0037](0037-block-marker-swapped-for-a-server-component.md)) and strips the CMS domain from links ([ADR 0036](0036-cms-links-are-made-relative.md)). Featured images from `_embed` get the same rewrite before they reach `next/image`.

This is recorded as reducing exposure, not as security. Anyone who finds the CMS's address can still reach its REST API, which is public by design because this app reads it anonymously. What the rewrite buys is that the address is not handed out: not in HTML, not in image requests, not in a client bundle. If that ever needs to be a boundary rather than a habit, the optional hardening, not adopted, is a Cloudflare rule in front of the CMS that admits only requests carrying a secret header, which this app's server-side requests would send.

## Considered options

- **Point the browser at the CMS for images and leave links as they are.** Simplest. Rejected: the CMS's address would be in every page, and readers who followed a CMS link would reach a 404.
- **Rewrite URLs in WordPress before they leave the CMS.** Rejected: WordPress would need to know the front end's media path and rewrite every URL it emits, including in editor-typed HTML, and its previews would break; rewriting where the HTML is rendered keeps the rule in one place.

## Consequences

- One parse pass owns every rewrite in `content.rendered`: links, images and the block marker. A new kind of CMS URL in the body (a video, a file link) is a change to that pass.
- `/media/` is part of the contract with the CMS: it maps to the uploads directory one to one, so a path under `wp-content/uploads/` is the same path under `/media/`.
- The uploads directory stays publicly reachable on the CMS, because the rewrite and the image optimizer fetch from it; it is served by the web server, not by WordPress's theme.

## Amendment, 2026-11-05: the rewrite forwards the CMS's response headers

The `/media/` rewrite is a proxy, and it passes the CMS's response through with its headers. A review of the slice 3 foundation showed four of them reaching the browser on a direct request to `/media/…`, each of which names or fingerprints the CMS:

- `Server`, from the CMS's web server, on every proxied response.
- `X-Powered-By`, from PHP, whenever WordPress answers instead of the web server: for example a missing upload, which the web server hands to WordPress and WordPress answers with its 404 page.
- `Link`, WordPress's `<https://{cms}/wp-json/>; rel="https://api.w.org/"` header, on the same WordPress-generated responses, a 404 for a missing upload among them. It carries the CMS's absolute address.
- `Location`, when the CMS answers with a redirect: the rewrite hands the 3xx to the browser instead of following it, so the browser is sent to the CMS's own URL.

Images rendered through `next/image` are fetched by the image optimizer on the server, and the browser sees the optimizer's response, not the CMS's; the leak is on requests that reach `/media/…` directly (an unoptimised image, a file link in the body, or anyone requesting the path).

The alternative is a Route Handler, `app/media/[...path]/route.ts`, that fetches `{base}/wp-content/uploads/{path}` on the server with `redirect: 'manual'`, turns a CMS redirect or error into its own plain response, and copies only an allow-list of headers: `content-type`, `content-length`, `etag`, `last-modified` and the cache headers (`cache-control`, `expires`). Its cost on Vercel is one function invocation for every media request that is not served from a cache: each fetch the image optimizer makes on a miss in its own cache, and each direct `/media/…` request the CDN has not cached. The rewrite costs none, because Vercel's routing layer proxies it without running a function.

The rewrite stays for now; the base it maps to and its build-time checks are in `apps/web/lib/media-rewrites.ts`, unit-tested on their own. The base is `WP_MEDIA_ORIGIN` when set, which may include the path WordPress is installed in (`https://example.com/blog`), and otherwise `WP_API_URL` without its `/wp-json` suffix, so a subdirectory install needs no extra setting. On a Vercel build (`VERCEL` set) a missing base fails the build; locally and in CI the rewrite is left out with a warning, because `next typegen` loads the same config with no CMS.

Decision pending.
