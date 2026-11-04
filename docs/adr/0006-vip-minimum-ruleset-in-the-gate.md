---
status: accepted
date: 2026-11-03
---

# The PHPCS gate adds the WordPress VIP Minimum ruleset

The WordPress Coding Standards catch escaping, sanitising, and nonce mistakes, but not the performance and platform habits CLAUDE.md asks for: no uncached or unbounded queries, short remote-request timeouts, no runtime file writes, no variable file includes. `automattic/vipwpcs` encodes those habits. `phpcs.xml.dist` adds `WordPressVIPMinimum` after the `WordPress` rule with no exclusions and no severity changes, so the VIP sniffs add checks without weakening any existing one.

## Considered options

- **`WordPress-VIP-Go`.** Rejected: it tunes the Minimum set for VIP's own infrastructure. It silences `WordPress.DB.SlowDBQuery.slow_db_query_meta_key` because VIP Go has a combined index on `meta_key, meta_value`, silences `EscapeOutput.ExceptionNotEscaped`, and lowers `EscapeOutput.UnsafePrintingFunction` because VIP trusts its translations. Cloudways and wp-env have none of that, so those relaxations would hide real problems here.
- **No VIP ruleset.** Rejected: the habits the project is built to would then be held by review alone, and the reviewer would be the one missing them.

## Consequences

- Includes use `__DIR__`, `dirname()`, or a constant named for its path rather than a variable, because `WordPressVIPMinimum.Files.IncludingFile` flags variable includes. The PHPUnit bootstrap pins the env-derived tests directory in `RESOURCE_HUB_TESTS_DIR` for that reason.
- `WordPressVIPMinimum.Performance.RemoteRequestTimeout` flags any remote request timeout above 3 seconds, and CLAUDE.md specifies 5 seconds for the revalidation request. The revalidation hook must resolve this when it is built: lower the timeout to 3 seconds or justify an exclusion in its own ADR.
