---
status: accepted
date: 2026-11-04
---

# The contract with the front end is JSON Schema in a shared package, not prose

The two halves of this demo agree on a handful of payloads: the body WordPress POSTs to `/api/revalidate/`, the front end's replies to it, the custom REST routes' responses, and the error shape WordPress produces. Before this decision the agreement was a contract section in each side's `CLAUDE.md`, maintained by hand, and it drifted at the first real contract change: one file got the new shape, the other kept the old, and nothing failed until the front end quietly ignored a field. We define the contract instead as JSON Schema (draft 2020-12) in a workspace package, `@colbitron/resource-hub-ui` at `packages/ui/`, with valid and invalid fixtures and a test that compiles every schema in strict mode and checks every fixture.

The point is where the schemas are consumed. PHPUnit validates every payload the plugin builds against them, and the front end proves its Zod readers against the same fixtures. Whichever side moves, the schema turns the drift into a red check on that side in the same pull request. Prose can describe intent but cannot fail; the semantics a schema cannot express live in the package README beside it, which is the contract's only full statement.

## Considered options

- **Prose in both `CLAUDE.md` files.** The status quo. Rejected: it drifted, and nothing can fail on drift.
- **A TypeScript or Zod definition as the source of truth.** Rejected: PHP cannot consume it, so the plugin would still be checked against prose or a hand-kept copy. JSON Schema is the one format a PHP validator and Zod can both read.
- **An OpenAPI document.** Rejected: WordPress's own REST schema describes the custom routes, the revalidation endpoint is one POST, and the component schemas are the part either side can check; a wrapper adds tooling without adding a check.
- **A separate contract repository.** The cleanest ownership story. Rejected: a third repository for a few files, with its own CI and release cadence, is more process than the demo warrants.

## Consequences

- A change to a payload is a change to a schema first, with a fixture for the new shape and one for the shape it forbids, in the same pull request as both consumers (ADR 0033). Every payload schema must have at least one valid and one invalid fixture.
- Strict mode keeps the schemas to keywords Ajv knows. The schemas use `if`/`then`/`else`, `not`, `oneOf` and cross-file `$ref`s, which JSON-Schema-to-Zod converters support unevenly, so the front end proves its readers against the fixtures rather than trusting a converter.
- **Reader policy: strict where we produce, lenient on unknown keys where we consume.** The schemas keep `additionalProperties: false` and each side checks what it produces exactly; a side that reads a payload drops keys it does not know rather than rejecting them, every rule on a known key unchanged. The reason is the deploy order: the CMS deploys first and changes are additive, so for the length of one deploy the CMS can send a key the front end does not know yet. The policy is stated in full in `packages/ui/README.md`.
- A new value for an existing enum, or a new `version`, is not additive: the reader answers a body it cannot read with a 400, so front-end support ships first for that one change. The alternative, a reader that revalidates broadly for an event it cannot read, is open in issue #51.
- The `version` field is fixed at 1 by `const`; a breaking change bumps it.
