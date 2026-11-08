# Resource Hub: CMS block theme

The CMS's own theme, for editors and logged-in previews only. The front end in `apps/web/` is the only public site, so anonymous visitors never see this theme's pages: the plugin's lockdown (`wp-content/plugins/resource-hub-wp/src/Lockdown/`, [ADR 0031](../../../docs/adr/0031-cms-theme-pages-are-for-logged-in-users.md)) answers them with a 404, and that 404 is rendered with this theme's `templates/404.html`. It is a demonstration of a pattern, written fresh, not production code.

## What is here

```
style.css            theme header only
theme.json           schema version 3; registers the header and footer template parts
templates/index.html every page a logged-in user sees: header, the main query's titles and content, footer
templates/404.html   the lockdown's 404: header, a heading and one sentence, footer
parts/header.html    the Resource Hub lockup (the mark and the wordmark, one link to /resources/), alone;
                     the mark is a copy of packages/ui/brand/mark.svg, held to it by BrandMarkTest
parts/footer.html    the publisher line
```

No PHP: a block theme needs none, so there is no `functions.php` for PHPCS to lint.

The lockup links to the CMS's own `/resources/`, the resource archive, which editors see and anonymous visitors get as a 404, by design: linking to the front end instead would put a link to it on the CMS domain, which ADR 0031 rules out.

## The two rules from issue #89

The 404 is the one page of this theme every anonymous visitor gets, so:

1. **It lists no pages.** The 404 template and the parts it includes hold no `core/navigation`, `core/page-list`, query or any other block that lists posts, pages or terms. A navigation block with no menu falls back to listing every published page, which would show anonymous visitors what exists.
2. **It prints no `<link rel="pingback">`.** A classic or compat `header.php` prints one itself; a block theme has no `header.php`, and no file it renders from mentions pingbacks. The plugin removes core's `X-Pingback` header (`src/Security/XmlRpc.php`).

`tests/phpunit/Theme/ThemeFilesTest.php` in the plugin checks the files: the 404 template and its parts may use only an allow list of fixed-content blocks, and no file it renders from (templates, parts, PHP, JSON, CSS, JavaScript) mentions pingbacks. `tests/e2e/theme-404.spec.js` checks the rendered 404 as an anonymous visitor: no navigation, no page or post titles, no pingback link or header. Neither stops an editor from adding a navigation block to the header in the Site Editor, which stores its own copy of the part in the database; the Playwright spec would catch it only on a site where that copy exists.

## Running it

`.wp-env.json` at the repository root mounts this directory into both wp-env sites. wp-env mounts a mapped theme but never activates it, on a new environment or an existing one, so its `afterStart` script runs `wp theme activate resource-hub` on the dev and tests sites after every `pnpm env:start`. The script calls `wp-env run`, so it needs `wp-env` on `PATH`; `pnpm env:start` puts the workspace's copy there, while a bare `wp-env start` from a shell without it fails at that step. The PHPUnit bootstrap then reinstalls the tests site on core's test theme, `default`, so the Playwright fixture in `tests/e2e/fixtures.js` activates the theme again before any spec runs.

## Not built yet

Slice 5 continues in [issue #89](https://github.com/Colbitron/resource-hub-wp/issues/89):

- **Assets:** the `packages/ui` tokens, `card.css` and the Figtree typeface, loaded only where used. The markup already uses the front end's lockup classes (`rh-brand`), but no stylesheet is loaded, so the pages render in the browser's defaults. Those classes live in `apps/web/components/brand.css`, which is the front end's own and not part of the contract, so the assets pull request must first move what the theme needs into `packages/ui`.
- **The remaining templates:** single resource, archives and pages; `index.html` stands in for all of them.
- **Deploy:** CI syncs only the plugin to the host, so this theme is not on the hosted CMS yet, and the hosted 404 is still rendered with the host's current theme.
- **The Site Editor revalidation notice** (issue #89's third note).
