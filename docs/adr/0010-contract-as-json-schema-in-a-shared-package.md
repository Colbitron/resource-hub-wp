---
status: accepted
date: 2026-11-04
---

# The contract with the front end is JSON Schema in a shared package, not prose

The two halves of this demo agree on a handful of payloads: the body WordPress POSTs to `/api/revalidate`, the front end's replies to it (a `200` with the paths it revalidated, or a `400`, `401` or `500` with an error, in two schemas), the two custom REST routes' responses, and the error shape WordPress produces. Before this decision the agreement was a "contract" section in each repository's `CLAUDE.md`, maintained by hand. The redesign of the revalidation payload that accompanies this decision (batches, `previous` state, term events, reserved type slugs) is the kind of change that makes prose in two places drift: one file gets the new shape, the other keeps the old, and nothing fails until the front end quietly ignores a field. We define the contract instead as JSON Schema (draft 2020-12) in a workspace package, `@colbitron/resource-hub-ui` at `packages/ui/`, with valid and invalid fixtures and a test that compiles every schema in strict mode and checks every fixture.

The point is where the schemas are consumed. PHPUnit here validates the payloads the plugin builds against them, so a change to the PHP that produces a body the schema rejects fails this repository's gate. The front end derives its Zod types from the same files, so a change to what it expects that the schemas do not describe fails that repository's build. Whichever side moves first, the schema turns the drift into a red test in that repository, before the other side has to find it in production. Prose can describe intent but cannot fail; a schema does both, because every property carries a `description` that states its meaning, and the semantics a schema cannot express (which state an event describes, how batches are deduplicated, the public URL shape) live in the package README next to it.

The package lives in this repository rather than a third one for two reasons. This side produces four of the six payloads, which makes it their natural owner: the plugin builds three (the revalidation request, the related response and the resolve response), and WordPress core produces the error shape on the plugin's own routes. The front end produces the other two, its `200` and error replies to the revalidation request. And `packages/` under the plugin root costs one line in `pnpm-workspace.yaml`. The deploy job's rsync allowlist already leaves it behind, so nothing new reaches the host. The package is not `private`, so that a tag workflow can publish it to GitHub Packages; publishing is outside the scope of this decision.

## Considered options

- **Prose in both `CLAUDE.md` files**, the status quo. Rejected: it drifted at the first real contract change, and nothing can fail on drift.
- **A TypeScript or Zod definition as the source of truth.** The front end would use it as is. Rejected: PHP cannot consume it, so the plugin side would still be checked against prose or against a second, hand-kept copy. JSON Schema is the one format both PHPUnit (through a validator library) and Zod (through a converter) can read.
- **An OpenAPI document.** It would also describe the routes, methods and headers. Rejected: the two custom routes are already described by WordPress's own REST schema, the revalidation endpoint is one POST, and the component schemas are the part either side can check; an OpenAPI wrapper adds tooling without adding a check.
- **A separate `resource-hub-contract` repository.** The cleanest ownership story. Rejected: a third repository for seven files, with its own CI and release cadence, is more process than the demo warrants, and this side produces most of the shapes.

## Consequences

- The schemas are the contract. A change to a payload is a change to a schema first, with a fixture for the new shape and one for the shape it forbids, in a pull request that both repositories' maintainers read. The contract sections in the two `CLAUDE.md` files become a pointer to the package.
- Every payload schema must have at least one valid and one invalid fixture, and the test fails otherwise. A schema nothing exercises is a bug.
- Strict mode in the test keeps the schemas to keywords Ajv knows, so a misspelt or unknown keyword fails the test instead of being silently ignored.
- The schemas use `if`/`then`/`else`, `not`, `oneOf` and cross-file `$ref`s, which JSON-Schema-to-Zod converters support unevenly: some drop a conditional or a `not`, some cannot follow a `$ref` into another file. Compiling here proves nothing about the front end's converter, so the front end must prove its converter's output, or its hand-written Zod, against these same fixtures: every valid fixture parses and every invalid one is rejected.
- PHPUnit on this side needs a JSON Schema validator for PHP. That dependency and the tests that use it land with the revalidation hook, which is also when the plugin first builds one of these bodies.
- Publishing to GitHub Packages is outside the scope of this decision. The front end copies or references the files by path; the `$id` of each schema is its raw URL on `main`, so a published package and a path reference resolve the same `$ref`s.
- The `version` field in the revalidation request is fixed at 1 by `const`. A breaking change to an event shape bumps it, and the front end rejects bodies it does not understand with a `400` rather than guessing.
