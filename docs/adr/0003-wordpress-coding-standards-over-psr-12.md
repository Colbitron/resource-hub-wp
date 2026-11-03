---
status: accepted
date: 2026-11-03
---

# WordPress Coding Standards win where they conflict with PSR-12

The code is checked against both the WordPress Coding Standards and PSR-12, but the two disagree on tabs versus spaces, brace placement, spacing inside parentheses, and snake_case versus camelCase methods. `phpcs.xml.dist` uses WordPress as the base and layers PSR-12 on top, excluding each PSR-12 sniff that contradicts a WordPress rule with a comment naming the conflict. PSR-12 still contributes what WordPress lacks, such as `declare` formatting and import rules.

## Considered options

- **PSR-12 as the base, WordPress on top.** Rejected: the code would then read unlike WordPress core and every other plugin a WordPress team maintains.
- **PSR-12 only, with `WordPress-Extra` for security sniffs.** Rejected for the same reason; the escaping and sanitising sniffs are the least of what the WordPress ruleset provides.

## Consequences

- Class files use StudlyCase names under PSR-4, so the WordPress file-name sniff is excluded.
- Anyone adding a PSR-12 exclusion must say which WordPress rule it yields to.
