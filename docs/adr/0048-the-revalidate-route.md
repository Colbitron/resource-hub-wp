---
status: accepted
date: 2026-11-05
---

# The revalidate route: digest comparison before the body, a bounded body, `{ expire: 0 }`, tags and paths, no CMS fetches

`POST /api/revalidate/` (`apps/web/app/api/revalidate/route.ts`) is the one authenticated endpoint on the front end and the one WordPress depends on for freshness ([ADR 0043](0043-fetch-cache-with-tags-without-cache-components.md)). It answers the contract in the root `CLAUDE.md` ("Revalidation request" and "Revalidation response") and the two response schemas in `packages/ui/schemas/`. This records the choices the contract leaves open. Defaults chosen overnight 2026-11-05, pending the human's line-by-line review of the route.

## Auth: SHA-256 digests compared with `timingSafeEqual`, before the body is read

The bearer is parsed strictly (`Authorization: Bearer <token>`, the scheme in any case as RFC 9110 allows, one space, a non-empty token with no whitespace), then the token and `REVALIDATE_SECRET` are each hashed with SHA-256 and the two digests compared with `crypto.timingSafeEqual`. Hashing first gives two inputs of equal length whatever the token's length, which `timingSafeEqual` requires and which a length check before it would leak; the comparison then takes the same time for a token that is one character off and one that is nothing like the secret. Auth runs before the body is touched, so an unauthenticated request costs one header read and two hashes, and the body cap below protects only requests that already hold the secret. Every failure is `401 { "error": "unauthorized" }`, exactly, so the plugin's notice can match it. A missing or empty secret is a `500` that says the front end has no secret configured and never echoes anything: that is a misconfiguration the editor should see, not an `unauthorized` that sends them to check the CMS's secret.

## The body: `application/json`, at most 64 KB, parsed with the reader schema

`Content-Type` must be `application/json` (parameters allowed). The body is read in chunks and abandoned as soon as it passes 64 KB, and a `Content-Length` over that is refused before the first byte, so no request can make the handler hold more than that in memory. The cap is 64 KB because a batch is at most 25 events ([ADR 0014](0014-one-php-request-is-one-batch.md)) of a few hundred bytes each, under 16 KB with several topics per event, so it leaves room for the longest slugs the schema allows, and because it is the bound the plugin puts on the response it reads from this route ([ADR 0013](0013-three-second-timeout-and-no-retries.md), amended 2026-11-05): the same number on both sides of the exchange. The bytes are decoded as UTF-8 (invalid bytes are malformed JSON), parsed, checked for `version` 1, and validated with the reader schema (`revalidateRequestSchema`, [ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md), amended 2026-11-05), which drops unknown keys and holds every known key to the contract, the 1-to-25 cap and the enum rule included: an unknown event name, event type or taxonomy is a `400`, as that amendment says.

## The error bodies

Every problem with the body is a `400 { "error": "…" }` whose message says in plain words what was wrong, naming the first issue's path (`events[0].previous.slug must not be empty`) and never a value, because the plugin stores this body and shows it to the editor ([ADR 0018](0018-revalidation-results-shown-in-the-editor.md)): a value could be long, could be HTML, and tells the editor nothing the path does not. Each case has its own sentence: not JSON, not an object, no `version`, a `version` this front end does not read, a wrong content type, a body over the cap, and a schema failure. A `500` is sent when the secret is missing and when `revalidateTag` or `revalidatePath` throws, with a sentence the editor can act on. Every response carries `Cache-Control: no-store`, and any method but `POST` is a `405` with `Allow: POST`.

## Revalidation: `revalidateTag(tag, { expire: 0 })` for every tag, `revalidatePath` for every path

`eventsToInvalidations` ([ADR 0046](0046-which-tags-and-paths-each-event-revalidates.md)) gives the tags and paths for the union of each event's current and previous state. Each tag goes to `revalidateTag` with the `{ expire: 0 }` profile, each path to `revalidatePath`, and the `200` lists the paths, as the response schema asks (`revalidated` is paths only; the tags are not reported).

The profile is the choice [ADR 0043](0043-fetch-cache-with-tags-without-cache-components.md) deferred. In Next.js 16, `revalidateTag` takes a second argument that sets how long stale content may still be served after the call: `'max'`, the documented recommendation, serves the stale entry while the refetch runs in the background; `{ expire: 0 }` makes the next request a cache miss that waits for fresh data. `{ expire: 0 }` was chosen because three of the five resource events are removals: with `'max'`, a trashed resource's page would be served once more, stale, to the first reader after the editor trashed it, and the refetch that finds nothing would only take effect for the second. The editor's notice says the page was revalidated, and it should mean it. The cost is one blocking refetch per cleared entry on its next request, against a CMS the front end already waits on for every miss. The route handler docs say the same for calls from outside a Server Action: `updateTag` is not available there, and `{ expire: 0 }` is the way to expire the data at once. The 16.4.5 implementation was checked: with `expire` 0 it marks the path as fully revalidated, as the docs say.

Both tags and paths, because they clear different things: tags clear the Data Cache entries that every page sharing that fetch reads, and `revalidatePath` clears the rendered page itself, which a tag alone does not touch for a prerendered route. The paths are the listings' first pages and the resource's page; pagination is covered by the tags ([ADR 0046](0046-which-tags-and-paths-each-event-revalidates.md)).

## No CMS fetches

The route fetches nothing: not `rest_url`, not the resource, not anything. `rest_url` is validated by the schema and otherwise ignored; the event's own `slug`, `types` and `topics` name what to clear, and the pages refetch on their next request. A route that fetched a URL from the body would be a server-side request forgery surface behind one shared secret, and a fetch would also spend part of the plugin's 3-second budget ([ADR 0013](0013-three-second-timeout-and-no-retries.md)). The unit test spies on `fetch` to hold this.

## Considered options

- **`'max'` as the profile.** The docs' recommendation and the faster answer for readers. Rejected: a removal would serve one more stale render, and the editor's notice would be wrong for that reader.
- **`updateTag`.** Expires at once, but only from Server Actions. Not available in a Route Handler.
- **`413` for a body over the cap and `415` for the wrong content type.** The HTTP-accurate statuses. Rejected: the contract and the error schema enumerate `400`, `401` and `500`, the plugin's notice is written around those three, and the message says what was wrong; a new status would be a contract change for no gain in what the editor sees.
- **`401` when the secret is missing.** It is a failed auth in the strict sense. Rejected: it would send the editor to check the CMS's secret when the front end's is the one missing.
- **Comparing the token and the secret directly with `timingSafeEqual`.** Rejected: it throws on unequal lengths, and checking the lengths first would end early for every wrong-length token.
- **Reporting the tags in the `200` as well.** Rejected: the response schema lists paths only, and the editor's notice shows paths.

## Consequences

- The plugin must post to `/api/revalidate/`, with the slash; the slashless path is a `308` the plugin does not follow ([ADR 0043](0043-fetch-cache-with-tags-without-cache-components.md)). The e2e spec records the `308`.
- The first request to a cleared page after a revalidation waits for the CMS. The ISR safety net is unchanged.
- A body over 64 KB is a `400` and nothing is revalidated. If a legitimate batch ever reaches it, the cap goes up with the schema, on both sides.
- The unit test (`apps/web/test/revalidate-route.test.ts`) spies on `next/cache` and holds the exact tags, profile and paths for a batch; the e2e spec (`apps/web/e2e/revalidate.spec.ts`) proves against the mock CMS that a cached fetch is served until an `update` event clears its tag and refetched after, which also settled [ADR 0023](0023-next-data-cache-is-the-only-http-cache.md)'s open question.
- The Playwright suite runs one worker, because every spec file resets the mock's data and counters in `beforeEach` and files running at once reset each other mid-test.
