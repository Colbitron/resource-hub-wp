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
- 2026-11-05: an anonymous `?wp_customize=on`, `?customize_changeset_uuid=…` or `?preview_id=…&preview_nonce=…` gets core's own `wp_die()` error page, a 500 or a 403, which core sends before `wp()` and so before the gate, with or without the plugin, and which shows no content.
- 2026-11-05: the 404 renders the active theme's header, and Twenty Twenty-Five's navigation there lists published pages, so the slice-5 theme's 404 template must not render navigation that lists pages.

## Choices made when it was built (2026-11-05)

- **The hook is `pre_handle_404` at priority 0.** 2026-11-05: the 404 is decided where core decides one, inside `wp()` right after the main query, which is before `send_headers()`, the `wp` action and every `template_redirect` listener; returning true there makes core's `handle_404()` stand down, and priority 0 puts it ahead of any plugin at the default priority. `template_redirect` at priority 0 was the alternative and was not taken: it runs after the headers have gone out, so a feed's content type, `ETag` and conditional 304 would already be sent.
- **The 404 is core's own.** 2026-11-05: the request is marked `error` 404 on the `WP` object, as `parse_request()` marks a path no rewrite rule matches, so `send_headers()` sends the 404 status, the no-cache headers and the HTML content type, and the theme's 404 template renders. The main query is also emptied, because `set_404()` keeps the feed flag, leaves the embed flag, and leaves the posts it found, any of which would let a feed, embed or looping template print content.
- **Redirects are switched off per request, with `wp_redirect()` as the last resort.** 2026-11-05: once a request is a 404, the `redirect_canonical` filter returns false, `old_slug_redirect_post_id` returns 0, core's `/admin` and `/login` shortcut is unhooked, and the `wp_redirect` filter returns false, so nothing on the site, a plugin on the host included, can send that visitor anywhere. None of this is registered for a logged-in request.
- **Only `robots.txt` itself is exempt, and sitemaps are off for anonymous visitors.** 2026-11-05: `robots` is a public query var anyone can add to a URL, so the gate exempts a request only when `robots` is the only query var of the main query, as it is for `/robots.txt`; with `feed`, `sitemap` or `attachment_id` beside it, the request is a 404 like any theme page, and the exempt request still gets the redirect guards. Matching the request path was not taken: the query vars are what WordPress acts on, and they read the same under pretty and plain permalinks. On top of the gate, `wp_sitemaps_enabled` is false for anyone not logged in from the moment the plugin boots, so core registers no sitemaps for them and answers every sitemap URL with a 404 of its own.
- **Previews are logged-in requests.** 2026-11-05: a preview nonce verifies only in the session of the user it was made for, so a valid preview is logged in and passes with them; `?preview=true` on its own exempts nothing. The stretch preview token will add its own exemption.
- **The favicon is a 404 too.** 2026-11-05: `/favicon.ico` is not a theme page, but core answers it with a redirect to the site icon, and the rule is no redirects.
- **The oEmbed REST endpoint stays.** 2026-11-05: the discovery links are removed; the endpoint is a REST route, REST stays public, and it only describes an embed page that is itself a 404.
- **REST responses get `X-Robots-Tag: noindex` from core.** 2026-11-05: `WP_REST_Server::serve_request()` sends it on every response, so the plugin adds the header to theme responses only, through `wp_headers`, and a PHPUnit test pins core's behaviour.
- **The 404 is uncacheable, like every core 404.** 2026-11-05: Varnish does not cache it, so every anonymous request reaches PHP; cacheable 404s were not taken because a plain 404 should look like any other.

