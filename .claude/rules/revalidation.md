---
paths:
  - "wp-content/plugins/resource-hub-wp/src/Revalidation/**"
  - "wp-content/plugins/resource-hub-wp/src/Admin/**"
  - "wp-content/plugins/resource-hub-wp/src/Editor/**"
  - "wp-content/plugins/resource-hub-wp/editor/revalidation-feedback/**"
  - "wp-content/plugins/resource-hub-wp/admin/**"
  - "wp-content/plugins/resource-hub-wp/tests/phpunit/Revalidation/**"
  - "wp-content/plugins/resource-hub-wp/tests/phpunit/Admin/**"
  - "wp-content/plugins/resource-hub-wp/tests/phpunit/Editor/**"
  - "apps/web/app/api/revalidate/**"
  - "apps/web/lib/tags.ts"
  - "apps/web/test/revalidate-route.test.ts"
  - "apps/web/test/tags.test.ts"
---

# Revalidation

- The editor never waits on the front end: events are queued per request, batched at `shutdown` (at most 25 per batch, deduplicated per object), and sent once from a WP-Cron single event with the payload built at schedule time. Never send during the save, never retry; the editor retries by saving again.
- Never send an event the shared schema would reject. The whole batch is one request, and the front end answers an unreadable body with a 400 that loses every event in it. Decode slugs, hold back a resource without exactly one type or a reserved type term event, and record why on that object.
- The secret travels only in the `Authorization` header of the send. It never appears in a result, in meta, in PostHog, in WP-CLI output or in any message; the status page says it is set, never what it is.
- Every result is stored on every object in the batch and shown where the editor is. Keep the wording in `ResultText::sentences()` as the one source. A 400 or 500 message from the front end is shown to the editor, so the route's messages name the first issue's path and never a value.
- On the front end: check the secret, then auth, then a capped body; clear every tag with `revalidateTag(tag, { expire: 0 })` and every path with `revalidatePath`, for the union of each event's current and previous state; fetch nothing. Tags come from the functions in `lib/tags.ts`, never built by hand.
- `Dispatcher.php`, `Sender.php`, `StatusPage.php` and `route.ts` are critical paths: read line by line before merge.

How it works end to end, including the gaps and the status page's rules: `docs/architecture/revalidation.md`. The payload and the response shapes: `packages/ui/README.md`.
