---
status: accepted
date: 2026-11-04
---

# The related route caches its result in its own salted object-cache entry

Since WordPress 6.1, `WP_Query` caches its results in the object cache, salted with the posts and terms `last_changed` values. That cache is correct but short-lived for this use: every autosave anywhere on the site bumps the posts `last_changed`, so it is emptied far more often than the related lists actually change. We keep our own layer: group `resource_hub`, key `related:{id}:{count}`, stored with `wp_cache_set_salted()` and read with `wp_cache_get_salted()`, salted with our own `resource_hub` `last_changed` plus core's `terms` `last_changed`, and a one-day expiry.

Our `last_changed` is bumped from `wp_after_insert_post` and `before_delete_post` ([ADR 0011](0011-revalidation-fires-on-wp-after-insert-post.md)) only when the old or the new status is `publish`, so drafts and autosaves leave it alone, and by term events ([ADR 0017](0017-term-events.md)). Core's `terms` salt covers term changes the plugin's own hooks do not see.

## Considered options

- **Rely on core's query cache alone.** Rejected for the reason above.
- **Transients.** Rejected: CLAUDE.md rules out transients as storage, and without a persistent object cache they would land in the options table.

## Consequences

- Redis with Object Cache Pro is live on the host (connected, drop-in valid, checked 2026-11-04), so the cache persists there. wp-env has no persistent object cache, so PHPUnit checks keys and salts within a request, not persistence ([ADR 0005](0005-hosted-wordpress-on-cloudways.md)).
- Any published resource changing empties every related entry. That is coarse but cheap, and correct without tracking which lists include which resource.
- `wp_cache_get_salted()` and `wp_cache_set_salted()` are `@since 6.9.0` in core's `wp-includes/cache-compat.php`, so the plugin requires WordPress 6.9 or newer: `Requires at least: 6.9` in the plugin header, and CLAUDE.md says the same. On 2026-11-04 the local and hosted sites ran WordPress 7.1.4.
- A one-day expiry clears the `LowExpiryCacheTime` sniff ([ADR 0006](0006-vip-minimum-ruleset-in-the-gate.md)).
