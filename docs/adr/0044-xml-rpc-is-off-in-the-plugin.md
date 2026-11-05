---
status: accepted
date: 2026-11-05
---

# XML-RPC is turned off in the plugin

The CMS is headless. The front end reads the REST API and editors work in the block editor, so no client uses XML-RPC. It is still on by default, and it is a save path the one-type rule does not guard ([ADR 0024](0024-type-paths-mirrored-on-both-sites.md)): `wp.editPost` can give a resource two types, or none, and publish it.

The plugin turns it off in `src/Security/XmlRpc.php`. `xmlrpc_enabled` returns false, which stops every method that logs in. That filter alone leaves the anonymous methods, pingbacks among them, so `xmlrpc_methods` returns an empty array as well, at the last priority so a method another plugin adds goes too. Core's IXR server still answers `system.listMethods`, `system.getCapabilities` and `system.multicall`, which it adds after the filter; they describe a server with nothing else on it, and any other method is a `-32601` fault. Nothing advertises the endpoint either: the `X-Pingback` header is removed through `wp_headers`, and core's RSD link is taken off `wp_head`.

## Considered options

- **Block `xmlrpc.php` at the host or at Cloudflare.** A Cloudways or Cloudflare rule would stop the request before PHP runs, which is cheaper under a flood. Not chosen as the switch: the rule would live outside the repository, wp-env and CI would not have it, and no test could show it holds. It can still be added on top as load shedding; the plugin's switch stays the one that is tested.
- **`xmlrpc_enabled` alone.** Rejected: since WordPress 3.5 it only covers authenticated methods, so `pingback.ping` would still answer.
- **Leave it on and guard the type rule in XML-RPC too.** Rejected: guarding a path nobody uses adds code to keep in step with the REST check for no reader.

## Consequences

- One fewer unguarded save path for the one-type rule: the classic `post.php` form, WP-CLI and PHP calls remain, and the revalidation hook still never sends an event whose top-level `types` isn't exactly one element.
- Pingbacks to the CMS stop. The CMS's theme pages are for logged-in users only ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)), so no public page of the CMS is there to be pinged.
- Clients that publish over XML-RPC, such as older desktop blogging apps, cannot connect. None is used here.
- A Playwright check posts `system.listMethods` and `pingback.ping` to `/xmlrpc.php` on wp-env, so the switch is tested over HTTP as well as in PHPUnit.
