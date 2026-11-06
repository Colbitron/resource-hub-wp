# Revalidation, end to end

For a contributor changing the revalidation hook, the sender, the results display or the front end's revalidate route. The contract (the request and response shapes) is in [`packages/ui/README.md`](../../packages/ui/README.md); the decisions behind the trigger and the send are [ADR 0011](../adr/0011-revalidation-fires-on-wp-after-insert-post.md), and the caching the route clears is in [caching.md](caching.md).

## The path a change takes

1. A hook in the plugin raises an event (`src/Revalidation/ResourceEvents.php`, `TermEvents.php`, `PageEvents.php`).
2. `Queue` collects the request's events and deduplicates them.
3. At `shutdown`, `Dispatcher` refreshes and checks each event, splits them into batches of at most `Queue::BATCH_SIZE` (25), stores a `pending` result on every object in each batch, and schedules one WP-Cron single event per batch with the full payload as the event's arguments, then calls `spawn_cron()`.
4. The cron callback runs `Sender`, which POSTs the batch to `{FRONTEND_URL}/api/revalidate/` once.
5. `ResultStore` writes the result to every object in the batch, and `PostHog` sends one event when configured.
6. On the front end, `app/api/revalidate/route.ts` checks the bearer, parses the body, and clears the tags and paths of every event's current and previous state.

Each class's docblock holds the reasoning for its own rules. This page holds what crosses classes and what an operator or reviewer needs to know.

## Triggers

**Resources.** `wp_after_insert_post`, filtered to `resource`, is the one trigger for saves: it runs after terms and meta are written, on every write path (REST, `wp_insert_post()`, `wp_publish_post()`, the trash). The event is derived from the change in `post_status` between `$post_before` and the saved post. `before_delete_post` covers a force delete of a published resource. The terms before a save are snapshotted at `pre_post_update`, because `$post_before` is the post row only. The public state of a `publish` or `update` is read again from the post at `shutdown`, because plain PHP can insert a post and assign its terms afterwards.

**Terms.** `edit_terms` captures the old slug and name; `created_`, `edited_` and `delete_{taxonomy}` queue events for `resource_topic` and `resource_type`. `resource_flag` is managed in code and sends nothing. Assigning terms to a resource is an `update` of that resource, not a term event.

**Pages.** The same two post hooks filtered to `page`, plus `update_option_` and `add_option_` for `show_on_front`, `page_on_front` and `page_for_posts`. A page becoming or ceasing to be the front page is an `update` between its own path and `/`. A password put on a served page is an `unpublish`, and one taken off a `publish`. Core resets the front-page options when the front page is trashed, so that trash arrives as an option change and a save, which the queue merges into one `trash` under `/`.

**Nothing is sent for:** a draft edit, a restore from the trash (it restores to draft), a term edit that changes neither slug nor name (description, parent), the children of a moved or renamed page (the front end's one `pages` tag reaches them), posts and every other post type, and `resource_flag` terms.

## What is held back before the send

The whole batch is one request, and the front end answers a body it cannot read with a 400, so one bad event would lose every event with it. `Dispatcher` therefore checks each event first:

- Every slug field of every event, `previous` included, is decoded as a save would store it (`Payload::decode_slugs()`), so a slug stored before the `SlugEscapes` rule cannot fail the batch. A slug that decodes to nothing names no path: `previous.slug` repeats the current slug, a top-level slug becomes the object's ID, and an empty type or topic is dropped.
- A resource event whose top-level `types` is not exactly one element is held back and recorded on the resource as `failed` with `Result::NO_SINGLE_TYPE_MESSAGE`. When only `previous.types` is invalid, the event goes out with the current type standing in (`ResourceState::with_valid_previous_types()`).
- A `resource_type` term event whose slug decodes to `topic` or `page` is held back with `Result::RESERVED_TYPE_MESSAGE`. A reserved `previous.slug` alone is replaced by the current slug and the event goes out.
- When the front-end URL or the secret is unset, or the secret breaks the rule in `Config::is_valid_secret()`, nothing is scheduled: the `not_configured` result is recorded at once, so an unconfigured site pays nothing per save.

## The send

- **From cron, not the save.** The editor never waits on the front end, and the result can still be recorded. The payload is built at schedule time because by the time cron runs a trashed post has been renamed `…__trashed` and a deleted one is gone. Each batch carries a fresh batch ID (`wp_generate_uuid4()`) in its cron arguments, because core drops a second single event with the same hook and arguments within ten minutes, and two identical batches (the status page's test button twice) must both run.
- **Under WP-CLI** the batch is sent synchronously at `shutdown` and the result is printed, since a cron run would never reach the terminal.
- **Timeout and retries.** `Sender::TIMEOUT` (3 seconds, the VIP sniff's cap) bounds how long a cron request holds a PHP worker; the response is bounded by `Sender::RESPONSE_LIMIT`. Nothing retries, because a retry queue needs its own storage, scheduling and failure display, and the editor is best placed to decide whether a failure matters by saving again. A failed send is recorded and shown to the editor, and the front end's hourly ISR interval ([caching.md](caching.md)) is the safety net that brings a page back in step after a send that failed.
- **The path has a trailing slash.** The front end runs with `trailingSlash: true`, which answers a POST to `/api/revalidate` with a 308 the sender does not follow (`redirection` is 0), so `Sender::PATH` is `/api/revalidate/`.
- **A cron run makes up to two requests per batch** (the send, then PostHog), so it holds a worker for at most about six seconds.

### When WP-Cron does not run

The send depends on WP-Cron spawning: it is a loopback request, not a system cron. How the host runs cron is in the [deploy runbook's host notes](../runbooks/deploy.md#host-notes).

- If WP-Cron is ever disabled in favour of a system cron, sends wait for that cron's interval, and the editor's post-save poll times out before the result arrives. The record stays `pending`, and after five minutes every display shows it as "No answer recorded: the send may not have run".
- A revalidation raised inside a cron run (a scheduled resource published by core's `publish_future_post`) is scheduled but delivered on the next cron spawn, because `spawn_cron()` does nothing while `DOING_CRON` is set. On a site with traffic that is the next page load.
- Until its event runs, a pending payload sits in the autoloaded `cron` option, at most 25 events per batch.

## Reading results

One result per batch, written to every resource, term and page in it as `_rh_last_revalidation` meta, each copy noting how many other changes travelled with it. The record's fields and the outcome names are the constants in `src/Revalidation/Result.php`; `status` moves from `pending` to `sent` or `failed`, and only outcome `ok` is `sent`. `ResultStore`'s docblock holds the guard that keeps an older send's result from overwriting a newer save's `pending`, and its known limits.

Where a result appears:

- **The block editor**, for the post types in `ResultStore::POST_TYPES` (resources and pages), after a non-autosave save: a script polls the `edit`-context REST field for up to about ten seconds and shows a snackbar for a success or a dismissible notice for anything else. It polls only when the save could have sent something: a resource that was or is published, a page that was or is served (`PagePath::is_served()`), so saving a password-protected page or the posts page shows nothing. On load, a last result that is not `sent` is shown. "This save's result" is a record whose `time` is at or after the saved post's `modified_gmt` and whose `batch_id` is not the one the save response carried. The sentences come from `ResultText::sentences()` in PHP. A 400 or 500 quotes the front end's `error` string, never the raw body. The body is stored cut to `Result::BODY_LIMIT` (1 KB) and the record's `truncated` flag says when it was cut; a cut body whose message cannot be read gets a note that the reply was too long to show instead of silence.
- **The Resources and Pages lists**, in a "Revalidation" column hidden by default (Screen Options turns it on), for bulk actions, trash and Quick Edit, which never open the editor. A failed trash stays invisible until someone turns the column on.
- **The term edit screen**, as an inline notice on its next load, for term events.
- **Settings > Resource Hub**, for the last test send, from the non-autoloaded option `resource_hub_last_test`, in the "Last test" row and the notice after the button. The option keeps the meta's fields, body and `truncated` included, so the sentence is the one the editor shows for a save.
- **PostHog**, when `RESOURCE_HUB_POSTHOG_KEY` and `RESOURCE_HUB_POSTHOG_HOST` are defined: one anonymous `revalidation_result` event per batch. It is the only record of a force delete's or a term delete's outcome, because the object that would hold the meta is gone, and the only history, because meta keeps the last result per object. Without PostHog those outcomes are printed under WP-CLI and not recorded at all from the admin. There is no `error_log()`: the VIP ruleset forbids it. Sampling and rollups for high volume are tracked in [issue #17](https://github.com/Colbitron/resource-hub-wp/issues/17).
- **A `pending` older than five minutes** is shown everywhere as "No answer recorded: the send may not have run", display only; the record is never rewritten.

## Configuration and the status page

`RESOURCE_HUB_FRONTEND_URL` and `RESOURCE_HUB_REVALIDATE_SECRET` come from PHP constants, falling back to options of the same name in lower case; a defined constant wins and the status page shows which source is in force. The two PostHog values are constants only. None is ever committed.

Settings > Resource Hub (`manage_options`) is a status page first. Rules it holds:

- The secret is never displayed, not even in part. Its field is never prefilled, so an empty submission keeps the stored value. A field whose constant is defined is disabled, because the constant wins.
- The front-end URL must be an origin only: `https://`, or `http://` for localhost and `127.0.0.1`, any port, no path, query, fragment or credentials, stored without a trailing slash. The send appends `/api/revalidate/`, so a path would double it. A configured URL that is not HTTPS, other than the local machine, is flagged. IP and link-local hosts are accepted by design, because an administrator sets the URL; the check is about carrying the secret safely, not about which hosts may be reached.
- The secret must meet [the contract's rule](../../packages/ui/README.md#configuration), which `Config::is_valid_secret()` checks. A secret in force that breaks the rule counts as not configured, with `Result::INVALID_SECRET_MESSAGE` stored as the cause, so the editor's notice can point to the settings page instead of saying only that something is unconfigured.
- Both options are stored with autoload off.
- "Send test revalidation" sends a real `update` event, never a synthetic ping, for the most recently modified published resource or one chosen in the searchable picker, so a pass proves the whole path a save takes. With nothing published the button is `aria-disabled` and says why. The result is recorded like any other: in that resource's meta, in PostHog, and in `resource_hub_last_test`. It is the quickest check after a deploy or a secret rotation.

## On the front end

`app/api/revalidate/route.ts` is the one authenticated endpoint. Its docblock holds the order of checks and the reasons. The rules a change must keep:

- The secret is checked before auth, auth before the body is read, and the body is capped and read within a deadline.
- Every body problem is a 400 whose message names the first issue's path and never a value, because the plugin stores the body and shows it to the editor.
- Every tag is cleared with `revalidateTag(tag, { expire: 0 })`, so a removal never serves one more stale render, and every path with `revalidatePath`. `revalidated` in the 200 lists paths only.
- The route fetches nothing, from the CMS or anywhere. `rest_url` is validated and otherwise ignored.
- A `topics` array has no `maxItems`; what that allows is in the [contract](../../packages/ui/README.md#semantics-the-schemas-assume).

**A cached bad 200 stays until an event or the interval clears it.** The Data Cache stores a 200 whose body fails the reader schema like any other 200, and fixing the CMS does not clear it. A test revalidation from the status page clears most of them, because every event clears `resources`, which the library listing, the by-ID, resolve and flag reads and the filter bar's term lists carry. Reads tagged only by their own slug or term (another resource by slug, another type's or topic's listing) wait for an event that names them, or for the interval.

## Gaps to know about

- Old topic URLs are a 404 after a re-slug; there is no topic redirect. Resource pages recover from a type re-slug by themselves, because the type segment is checked and a mismatch redirects.
- A term `delete` result is recorded in PostHog only.
- A batch over 25 events is split into several requests, each with its own result.
- A green CI run does not mean a stale page was refreshed: revalidation is per event, and a send that failed is retried only by an editor.
