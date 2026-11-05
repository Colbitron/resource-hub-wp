---
status: accepted
date: 2026-11-04
---

# The CMS's theme pages are for logged-in users only

WordPress still renders its own pages with its theme: single resources at the mirrored `/resources/[type]/[slug]/` paths ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)), archives, and every other page the theme can produce. The front end is the only public site, so those pages are a second, unmaintained copy of it on a domain readers should never see. They could redirect to `FRONTEND_URL` plus the same path. They do not: anonymous visitors to any page WordPress would render with its theme get a 404, with no redirect. Logged-in users see the pages as before, so editors' previews keep working. The REST API is unaffected, because the front end reads it anonymously, and so are the admin, the login page and cron.

"Logged-in only" covers every route the theme answers, including feeds, core sitemaps, author archives and search results, and the oEmbed discovery links are removed from page heads. REST stays public.

The 404 is decided before core's canonical and old-slug redirects run, so an anonymous visitor gets no redirect from the CMS of any kind. On top of that, `robots.txt` disallows the whole CMS, and CMS responses carry `noindex`: a meta robots tag on the pages logged-in users see, and an `X-Robots-Tag: noindex` header.

## Why a 404 and not a redirect

- **A redirect would make the CMS a second router.** To send a reader to the right place it would need the front end's type-mismatch and old-slug rules ([ADR 0025](0025-redirects-are-computed-308s-with-no-store.md), [ADR 0029](0029-old-slugs-resolve-through-core.md)) kept in step in PHP, and Varnish caches the CMS's anonymous HTML, so a stale cached redirect could loop.
- **A redirect advertises the CMS.** Every redirect is a link from the CMS domain to the front end, and the CMS's address is kept out of the browser on the front end's side for the same reason.
- **A 404 says nothing.** It does not tell a visitor whether a resource exists, unlike a 403 or a redirect to the login page.

## Considered options

- **Redirect the CMS's pages to the front end.** Rejected for the reasons above.
- **Leave the theme pages public.** Rejected: duplicate content at the same paths on a second domain, and a theme nobody maintains.
- **A 403 or a redirect to `wp-login.php`.** Rejected: both confirm that something is there.

## Consequences

- `robots.txt` itself, the uploads directory and the REST API stay reachable anonymously. The uploads are static files the web server serves without WordPress, and the front end's `/media/` rewrite reads them.
- A crawler that obeys the `robots.txt` disallow never fetches a page, so it never sees the `noindex`; the header is for crawlers that ignore `robots.txt` and for responses reached some other way, and the 404 is what keeps the content out either way.
- `get_permalink()` still returns the absolute CMS URL; the front end strips the domain ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)).
