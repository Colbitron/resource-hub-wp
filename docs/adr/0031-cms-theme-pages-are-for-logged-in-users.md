---
status: accepted
date: 2026-11-04
---

# The CMS's theme pages are for logged-in users only

WordPress still renders its own pages with its theme: single resources at the mirrored `/resources/[type]/[slug]/` paths, archives, feeds, sitemaps and every other page the theme can produce. The front end is the only public site, so those pages are a second, unmaintained copy of it on a domain readers should never see. They could redirect to the front end. They do not: anonymous visitors to any page WordPress would render with its theme get a 404, with no redirect of any kind. Logged-in users see the pages as before, so editors' previews keep working. The REST API, the admin, the login page, cron and the uploads directory are unaffected. On top of that, `robots.txt` disallows the whole CMS and theme responses carry `noindex, nofollow`.

## Why a 404 and not a redirect

- **A redirect would make the CMS a second router.** It would need the front end's type-mismatch and old-slug rules kept in step in PHP, and Varnish caches the CMS's anonymous HTML, so a stale cached redirect could loop.
- **A redirect advertises the CMS.** Every redirect is a link from the CMS domain to the front end, and the front end keeps the CMS's address out of the browser for the same reason (ADR 0040).
- **A 404 says nothing.** It does not tell a visitor whether a resource exists, unlike a 403 or a redirect to the login page.

## Considered options

- **Redirect the CMS's pages to the front end.** Rejected for the reasons above.
- **Leave the theme pages public.** Rejected: duplicate content at the same paths on a second domain, and a theme nobody maintains.
- **A 403 or a redirect to `wp-login.php`.** Rejected: both confirm that something is there.

## Consequences

- The 404 is decided before core's canonical and old-slug redirects run, and `wp_redirect()` itself is switched off for that request, so nothing on the site can send an anonymous visitor anywhere. How it is built is in the `src/Lockdown/` docblocks.
- The uploads directory stays reachable anonymously: the web server serves it without WordPress, and the front end's `/media/` rewrite reads it.
- `get_permalink()` still returns the absolute CMS URL; the front end strips the domain.
- A crawler that obeys `robots.txt` never sees the `noindex, nofollow`; the header is for the rest, and the 404 keeps the content out either way.
- The theme planned for slice 5 must not render navigation that lists pages on its 404 template (issue #50).
