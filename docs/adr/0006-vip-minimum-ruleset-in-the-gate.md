---
status: accepted
date: 2026-11-03
---

# The PHPCS gate adds the WordPress VIP Minimum ruleset

The WordPress Coding Standards catch escaping, sanitising, and nonce mistakes, but not the performance and platform habits CLAUDE.md asks for: no uncached or unbounded queries, short remote-request timeouts, no runtime file writes, no variable file includes. `automattic/vipwpcs` encodes those habits. `phpcs.xml.dist` adds `WordPressVIPMinimum` after the `WordPress` rule. Minimum replaces several WordPress sniffs with stricter VIP ones (its file-operation errors in place of WordPress's warnings, for example) but drops `WordPress.Security.ValidatedSanitizedInput.MissingUnslash` outright, so the ruleset restores it at severity 5; a bare `<rule ref>` does not. With that restored, the VIP sniffs add checks without weakening any existing one.

## Considered options

- **`WordPress-VIP-Go`.** Rejected: it tunes the Minimum set for VIP's own infrastructure. Most importantly, it downgrades every `WordPressVIPMinimum.Functions.RestrictedFunctions.file_ops_*` finding (`file_put_contents`, `unlink`, `rename`, `touch`, and the rest) from an error to a severity-6 warning, because VIP Go permits writes under `/tmp` and uploads. This project allows no filesystem writes at runtime, and [ADR 0005](0005-hosted-wordpress-on-cloudways.md) makes PHPCS the check that holds that rule, so Minimum's errors are what we want. Among other relaxations, it also silences `WordPress.DB.SlowDBQuery.slow_db_query_meta_key` because VIP Go has a combined index on `meta_key, meta_value`, silences `EscapeOutput.ExceptionNotEscaped`, and lowers `EscapeOutput.UnsafePrintingFunction` because VIP trusts its translations. Cloudways and wp-env have none of that.
- **No VIP ruleset.** Rejected: the habits the project is built to would then be held by review alone, and the reviewer would be the one missing them.

## Consequences

- Includes use `__DIR__` or `dirname()`, because `WordPressVIPMinimum.Files.IncludingFile` flags variable includes. The one exception is the PHPUnit bootstrap, which loads the core test library from `WP_TESTS_DIR` by design; the sniff is excluded for that file alone, so a variable include anywhere else still fails the gate.
- The planned code will trip predictable sniffs: a related-by-topic `WP_Query` raises `WordPress.DB.SlowDBQuery.slow_db_query_tax_query`; `post__not_in` raises `WordPressVIPMinimum.Performance.WPQueryParams.PostNotIn`; `meta_query` and `meta_key` raise the slow-query warnings; `wp_cache_set()` with an expiry under 300 seconds raises `LowExpiryCacheTime.LowCacheTime`; `get_posts()` raises an uncached-function warning; direct `$wpdb` calls raise `DirectDatabaseQuery` warnings; `error_log()`, `posts_per_page => -1`, and `nopaging` are errors. Warnings fail the gate too, so each is either written around in code or gets a scoped, reasoned exclusion in `phpcs.xml.dist`, recorded in that slice's ADR.
- `WordPressVIPMinimum.Performance.RemoteRequestTimeout` flags any remote request timeout above 3 seconds, and CLAUDE.md specifies 5 seconds for the revalidation request. The revalidation hook must resolve this when it is built: lower the timeout to 3 seconds or justify an exclusion in its own ADR.
