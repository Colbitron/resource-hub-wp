---
status: accepted
date: 2026-11-03
---

# PHPUnit stays on 9.6 because the WordPress core test library tops out there

PHPUnit 12 is current, and a new project would normally start there. The plugin's integration tests run inside the WordPress core test library, which wp-env clones from `wordpress-develop` at the installed core version. As of WordPress 7.1 that library still depends on `yoast/phpunit-polyfills` 1.x, whose own constraint allows PHPUnit 4.8 through 9 only, and its `phpunit.xml.dist` targets the 9.x schema. We pin `phpunit/phpunit` to `^9.6` and write tests against `yoast/phpunit-polyfills` 4.x, which spans PHPUnit 7.5 through 12.

## Consequences

- When core raises its ceiling, the only change here is the PHPUnit constraint; test code written against the polyfills carries over.
- `phpunit.xml.dist` uses PHPUnit 9 attribute names (`convertDeprecationsToExceptions`, the `<coverage>` element) and will need the 10+ migration when the pin moves.
