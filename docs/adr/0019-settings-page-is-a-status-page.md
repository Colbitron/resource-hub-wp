---
status: accepted
date: 2026-11-04
---

# The settings page is a status page with a test button

The front-end URL and revalidation secret come from the `RESOURCE_HUB_FRONTEND_URL` and `RESOURCE_HUB_REVALIDATE_SECRET` constants, falling back to options ([ADR 0005](0005-hosted-wordpress-on-cloudways.md)). CLAUDE.md planned "a small settings page" for the fallback. When a revalidation fails, the first question is which configuration is in force and whether the front end answers at all, and a page of input fields answers neither. The page is therefore a status page first: it shows which source is active for each value (constant or option), never displays the secret, and has a "Send test revalidation" button.

The button sends a real `update` event for a published resource, not a synthetic ping, so a pass proves the whole path the front end takes for a save: the bearer check, the schema, and the revalidation of real paths and tags. It defaults to the most recently modified published resource, and a searchable picker lets the admin choose a specific published resource instead. With no published resource there is nothing real to send, so the button is disabled.

Because it is a real event, its result is recorded like any other: in the chosen resource's `_rh_last_revalidation` meta ([ADR 0018](0018-revalidation-results-shown-in-the-editor.md)) and, when PostHog is configured, as a PostHog event ([ADR 0032](0032-revalidation-results-logged-to-posthog.md)). It is also stored in a non-autoloaded option, which the status page shows, so the page can answer "did the last test pass?" without loading that option on every request.

Amended 2026-11-05, with the choices the build made. The page also writes the two fallback options, through the Settings API: the front-end URL must be `https://`, with `http://localhost` and `http://127.0.0.1` allowed for development, with no query string, fragment or credentials, and is stored without a trailing slash, else the stored value is kept and a settings error says why; the secret field is never prefilled, so an empty submission keeps the stored secret, and a field whose constant is defined is disabled because the constant wins. A configured URL that is not HTTPS, other than the local machine, is flagged on the status table. The picker is server-rendered with the twenty most recently modified published resources, and a small script searches the public `wp/v2/resources` collection with `status=publish` as the admin types; the page itself needs `manage_options`. The last test's record goes in the non-autoloaded option `resource_hub_last_test`: the resource's own record without the body, plus the resource's ID. The handler is an `admin-post.php` action with a nonce and the capability check, and it redirects back with `rh_test` naming what happened, which the page turns into a notice.

## Considered options

- **A synthetic test event, or a `HEAD` or ping request.** Rejected: it would pass while a real payload still failed the front end's schema or its revalidation, which is exactly the failure the button is for.
- **Storing the result in an autoloaded option.** Rejected: WordPress loads autoloaded options on every request, and only this page reads the result.

## Consequences

- A defined constant wins over the option, as CLAUDE.md specifies, and the page shows which one is in force.
- The secret is write-only from the admin's point of view; the page can say it is set, never what it is.
- The test button is the quickest check after a deploy or a secret rotation, without editing content: it re-sends a resource's current state, which on the front end is an ordinary refresh of that resource.
- A test leaves its result on the chosen resource, where an editor opening that resource sees it like the result of a save.
- The page needs a capability check and a nonce on the test action, like every admin action here.
