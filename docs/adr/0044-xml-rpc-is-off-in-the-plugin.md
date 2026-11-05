---
status: accepted
date: 2026-11-05
---

# XML-RPC is turned off in the plugin

The CMS is headless. The front end reads the REST API and editors work in the block editor, so no client uses XML-RPC. It is still on by default, and it is a save path the one-type rule does not guard ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)): `wp.editPost` can give a resource two types, or none, and publish it.

The plugin turns it off in `src/Security/XmlRpc.php`. `xmlrpc_enabled` returns false, which stops every method that logs in. That filter alone leaves the anonymous methods, pingbacks among them, so `xmlrpc_methods` returns an empty array as well, at the last priority so a method another plugin adds goes too. Core's IXR server still answers `system.listMethods`, `system.getCapabilities` and `system.multicall`, which it adds after the filter; they describe a server with nothing else on it, and any other method is a `-32601` fault. No page or header points at the endpoint either: the `X-Pingback` header is removed through `wp_headers`, and core's RSD link is taken off `wp_head`. The endpoint still describes itself: `GET /xmlrpc.php?rsd` returns an RSD document, which `xmlrpc.php` prints before the server is built, so no filter reaches it.

## Considered options

- **Block `xmlrpc.php` at the host or at Cloudflare.** A Cloudways or Cloudflare rule would stop the request before PHP runs, which is cheaper under a flood. Not chosen as the switch: the rule would live outside the repository, wp-env and CI would not have it, and no test could show it holds. It can still be added on top as load shedding; the plugin's switch stays the one that is tested.
- **`xmlrpc_enabled` alone.** Rejected: since WordPress 3.5 it only covers authenticated methods, so `pingback.ping` would still answer.
- **Leave it on and guard the type rule in XML-RPC too.** Rejected: guarding a path nobody uses adds code to keep in step with the REST check for no reader.

## Consequences

- One fewer unguarded save path for the one-type rule: the classic `post.php` form, WP-CLI and PHP calls remain, and the revalidation hook still never sends an event whose top-level `types` isn't exactly one element.
- Pingbacks to the CMS stop. The CMS's theme pages are for logged-in users only ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)), so no public page of the CMS is there to be pinged.
- Clients that publish over XML-RPC, such as older desktop blogging apps, cannot connect. None is used here.
- `<link rel="pingback">` printed by a classic theme's `header.php`, or by core's theme-compat header, is untouched, because it comes from the theme, not `wp_head`. The block theme planned for slice 5 should not print one; if it ever uses a classic or compat header, that link has to go there.
- Trackbacks are a separate path, `wp-trackback.php`, which does not go through XML-RPC, so this switch does not stop them. Checked by reading core, not tested over HTTP: `wp-trackback.php` answers whenever `pings_open()` is true for the post, and resources do not declare `trackbacks` support, so core creates them with `ping_status` closed.
- A Playwright check posts `system.listMethods` to `/xmlrpc.php` on wp-env, so the method list is tested over HTTP as well as in PHPUnit. Pingbacks are tested in PHPUnit only: core drops `pingback.ping` itself outside the `production` environment type, and wp-env is `local`, so a pingback over HTTP there fails with or without the plugin. The PHPUnit test removes core's environment filter first, so it fails without the plugin.
