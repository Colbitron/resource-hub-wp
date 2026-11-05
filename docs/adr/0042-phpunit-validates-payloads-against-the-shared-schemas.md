---
status: accepted
date: 2026-11-04
---

# PHPUnit validates payloads against the shared schemas through a wp-env mapping and `opis/json-schema`

[ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md) promised that PHPUnit would validate every revalidation payload the plugin builds against the JSON Schemas in `packages/ui/schemas/` once the hook existed. Two things stood in the way. wp-env mounts only the plugin directory, so inside the tests container `packages/ui/` did not exist. And PHP has no built-in JSON Schema validator, and the schemas use draft 2020-12 features (`$ref` across files, `if`/`then`/`else`, `oneOf`, `not`, `const`, `uniqueItems`) that older validators drop.

The mount is a `mappings` entry in the root `.wp-env.json`: `"packages/ui": "./packages/ui"`. wp-env's `mappings` map a path relative to the WordPress root in the container to a host path, so the package sits at `/var/www/html/packages/ui` in both environments, the same place relative to the WordPress root that it has relative to the repository root. The tests find it with one expression, `dirname( __DIR__, 6 ) . '/packages/ui'` from `tests/phpunit/Revalidation/`, which also resolves on the host, in CI and in any checkout with the same layout. The validator is `opis/json-schema` (2.x), a dev dependency in the plugin's `composer.json`: it implements draft 2020-12 in full, resolves cross-file `$ref`s against a registered `$id`, and ships the `uri` format. The test helper registers every `*.schema.json` under its `$id`, as the package README says a consumer must, and every payload a test builds is checked as the JSON `wp_json_encode()` would send.

One test also runs every `revalidate-request` fixture in `packages/ui/fixtures/` through the PHP validator: the valid ones must pass and the invalid ones must fail. That proves the PHP and Node validators read the schemas the same way, so a green PHPUnit means the same thing as a green `pnpm test:schemas`.

## Considered options

- **Copy the schemas into the plugin's tests.** Rejected: a copy is the drift ADR 0010 exists to prevent, and nothing would fail when the two diverged.
- **Mount the whole repository as the WordPress root.** Rejected: wp-env would treat the repository as a WordPress install, and the plugin's path inside the container would change for every other command.
- **`justinrainbow/json-schema`.** The most common PHP validator. Rejected: its draft 2020-12 support is partial, and the schemas' `if`/`then`/`else` and cross-file `$ref`s are exactly the features it handles unevenly.
- **Check the PHP output from Node instead.** Rejected: it needs a second harness to run PHP and capture its output, when the PHPUnit test already has the payload in hand.

## Consequences

- `.wp-env.json` changes, so wp-env has to be restarted once after pulling (`pnpm env:start` re-reads it). CI's wp-env cache key already hashes the file.
- `opis/json-schema` is a dev dependency only; the deploy's rsync does not ship `vendor/` dev packages to the host, and the plugin never validates at runtime.
- A revalidation test fails with the validator's error path (`/events/0/types`) when the plugin builds a body the contract rejects, which is the check ADR 0010 asked for. A change to a schema that the plugin does not follow now fails PHPUnit in the same pull request.
- The mapping is read-only in practice: nothing in the container writes to `packages/ui/`.
