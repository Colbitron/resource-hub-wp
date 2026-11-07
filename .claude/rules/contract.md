---
paths:
  - "packages/ui/**"
  - "apps/web/lib/wp/schemas/**"
  - "apps/web/test/schemas.test.ts"
  - "apps/web/lib/routes.ts"
  - "apps/web/lib/wp/resolve.ts"
  - "apps/web/lib/wp/pages.ts"
  - "apps/web/app/api/revalidate/**"
  - "wp-content/plugins/resource-hub-wp/src/Revalidation/Payload.php"
  - "wp-content/plugins/resource-hub-wp/src/Revalidation/ResourceState.php"
  - "wp-content/plugins/resource-hub-wp/src/Revalidation/Queue.php"
  - "wp-content/plugins/resource-hub-wp/src/Revalidation/Result.php"
  - "wp-content/plugins/resource-hub-wp/src/ContentModel/ReservedTypeSlugs.php"
  - "wp-content/plugins/resource-hub-wp/src/ContentModel/ReservedPageSlugs.php"
  - "wp-content/plugins/resource-hub-wp/src/ContentModel/SlugEscapes.php"
  - "wp-content/plugins/resource-hub-wp/src/Pages/PagePath.php"
  - "wp-content/plugins/resource-hub-wp/src/Rest/**"
  - "wp-content/plugins/resource-hub-wp/tests/phpunit/Revalidation/Schema*.php"
  - "wp-content/plugins/resource-hub-wp/tests/phpunit/Rest/**"
---

# The contract

- `packages/ui/schemas/` is the source of truth and `packages/ui/README.md` the only full statement of the semantics. Change a schema and its fixtures first (one valid and one invalid fixture per shape), then the README, then both consumers, in one pull request.
- Changes stay additive: add before anything relies on it, remove only after nothing does. A new enum value, a new event `type`, a new term `taxonomy` or a new `version` is not additive; it ships front-end support first.
- Strict where we produce, lenient on unknown keys where we consume: `additionalProperties: false` in the schemas, a reader that drops unknown keys on the consuming side, and the `…Strict` export proved against the fixtures.
- Every public URL has a trailing slash; `topic` and `page` are never type slugs; `resources`, `api`, `media` and `_next` are never top-level page slugs. A slug is stored in WordPress's lower-case percent-encoded form and never holds an escape the front end's router decodes.
- Error bodies are core's `WP_Error` shape on the CMS and `{ "error": "…" }` on the front end; the plugin shows the front end's messages to editors, so they are plain and never quote a value.
- Do not describe the block's render callback as built (issue #50).

The full statement: `packages/ui/README.md`. The decision: ADR 0010.
