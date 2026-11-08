# Resource Hub: CMS block theme

The CMS's own theme, for editors and logged-in previews only. The front end in `apps/web/` is the only public site, so anonymous visitors never see this theme's pages: the plugin's lockdown (`wp-content/plugins/resource-hub-wp/src/Lockdown/`, [ADR 0031](../../../docs/adr/0031-cms-theme-pages-are-for-logged-in-users.md)) answers them with a 404, and that 404 is rendered with this theme's `templates/404.html`. It is a demonstration of a pattern, written fresh, not production code.

## What is here

```
style.css            theme header only
theme.json           schema version 3: Figtree, the presets and the base styles on the --rh- tokens,
                     and the header and footer template parts
functions.php        registers and enqueues the three stylesheets in build/
templates/index.html every page a logged-in user sees: header, the main query's titles and content, footer
templates/404.html   the lockdown's 404: header, a heading and one sentence, footer
parts/header.html    the Resource Hub lockup (the mark and the wordmark, one link to /resources/), alone;
                     the mark is a copy of packages/ui/brand/mark.svg, held to it by BrandMarkTest
parts/footer.html    the publisher line
package.json         the theme's build, a pnpm workspace package
scripts/build.mjs    copies the contract package's files into build/
figtree.sha256       the SHA-256 of the Figtree file the theme ships, in `shasum -a 256` form
build/               gitignored; written by `pnpm build`
```

A block theme gives editors the Site Editor (Appearance > Editor), whose Pages section can edit pages too. Edit pages in the post editor instead: a Site Editor save still revalidates the front end and records its result, but shows no revalidation notice (issue #89's third note, settled; `docs/architecture/revalidation.md`, "Reading results").

The lockup links to the CMS's own `/resources/` rather than to the front end: editors see the resource archive there, and anonymous visitors get the lockdown's 404. ADR 0031 rejects redirecting to the front end because each redirect is a link from the CMS domain to it, and the lockup follows the same reasoning.

## The two rules from issue #89

The 404 is the one page of this theme every anonymous visitor gets, so:

1. **It lists no pages.** The 404 template and the parts it includes hold no `core/navigation`, `core/page-list`, query or any other block that lists posts, pages or terms. A navigation block with no menu falls back to listing every published page, which would show anonymous visitors what exists.
2. **It prints no `<link rel="pingback">`.** A classic or compat `header.php` prints one itself; a block theme has no `header.php`, and no file it renders from mentions pingbacks. The plugin removes core's `X-Pingback` header (`src/Security/XmlRpc.php`).

`tests/phpunit/Theme/ThemeFilesTest.php` in the plugin checks the files: the 404 template and its parts may use only an allow list of fixed-content blocks, and no file it renders from (templates, parts, PHP, JSON, CSS, JavaScript) mentions pingbacks. `tests/e2e/theme-404.spec.js` checks the rendered 404 as an anonymous visitor: no navigation, no page or post titles, no pingback link or header. Neither stops an editor from adding a navigation block to the header in the Site Editor, which stores its own copy of the part in the database; the Playwright spec would catch it only on a site where that copy exists.

## Assets

The theme draws with the contract package, `@colbitron/resource-hub-ui` (`packages/ui/DESIGN.md`, "Consumers and loading"), so a logged-in preview looks like the front end. The host never sees the pnpm workspace, so `scripts/build.mjs` copies what the theme loads into `build/`, byte for byte: `tokens.css`, `brand.css` (the lockup's classes), `fonts/figtree-latin-wght-normal.woff2` with `fonts/LICENSE-Figtree.txt` beside it, and `fonts/figtree-fallback.css`. It also writes `build/assets.php`, each copy's SHA-256, which `functions.php` takes the stylesheets' versions from. The root's `pnpm build` runs it alongside the plugin's build (pnpm runs the two packages' builds concurrently; neither reads the other's output), and CI's plugin gate runs `pnpm build` before PHPUnit and Playwright, as for the block.

- **`theme.json`** registers Figtree with `fontFace` from `file:./build/fonts/…`, under the plain name `Figtree`, with the front end's `font-display: swap`; it leaves `--rh-font-figtree` unset, so `--rh-font-sans` falls back to that name. The one font-family preset is `"Figtree", var(--rh-font-sans)`: core names the `@font-face` after the first family in the preset, and the rest is the token's stack with its fallback faces. The palette is every `--rh-color-*` token, the font sizes every `--rh-text-*` one, the spacing sizes every `--rh-space-*` one, and `layout.contentSize` and `wideSize` are `--rh-measure` and `--rh-measure-wide`, each written as `var(--rh-…)`, never as a value, so a value changes only in `tokens.css`. A slug is the token's suffix as core spells it in a custom property (`2xl` is `2-xl`). The five mark accents are not in the palette, since they are for small marks only, never text. Custom colours, gradients, duotones and font sizes are off, and core's default palette, gradients, duotones, font sizes and spacing sizes are hidden from the editor's pickers, so an editor picks only from the tokens. Hidden, not removed: core still prints those defaults' custom properties and their `.has-*` classes. Core's default shadows and aspect ratios are not hidden. The base styles set the body's colours, Figtree, the body size and leading, the link colour and the headings' weight, tracking and leading from the tokens.
- **`functions.php`** registers `resource-hub-tokens`, `resource-hub-figtree-fallback` and `resource-hub-brand` on `init` and enqueues them on `enqueue_block_assets`, which reaches the CMS's own pages and the iframed editor canvas, and not the editor's admin page around the canvas. `tokens.css` sets `color-scheme: light dark` and writes every colour with `light-dark()`, so the pages and the canvas follow the reader's system preference, as the front end does by default.
- **One copy of the tokens.** The plugin's related-resources block names the same `resource-hub-tokens` handle in its `block.json`, and WordPress prints a handle once, so a page with the block loads `tokens.css` once. The theme registers the handle first; the plugin registers its own copy (`build/shared/tokens.css`) at a later `init` priority only when no theme has, so the block keeps its tokens in any theme (`src/Blocks/SharedTokens.php` in the plugin).

The plugin's PHPUnit suite holds all of it to the package: `tests/phpunit/Theme/ThemeAssetsTest.php` fails when a copy in `build/` is not the package's file byte for byte, when `build/assets.php` holds a stale hash, or when the package's Figtree is not the file `figtree.sha256` records, so a new font file means changing the record with it; `tests/phpunit/Theme/ThemeTokensTest.php` fails when the presets are not exactly the tokens, in order, when `theme.json` writes a raw colour or length, or names a token that does not exist. Playwright's `tests/e2e/theme-assets.spec.js` counts the token declarations on a page with the block, on the CMS's page and in the editor canvas, and checks Figtree, the lockup and both schemes. PHPCS lints this directory's PHP with the plugin's ruleset (`phpcs.xml.dist`), and the root's `pnpm lint:js`, which CI's plugin gate runs, lints and checks the formatting of `scripts/` with this package's own `wp-scripts lint-js` (ESLint reads no file outside the directory it runs in, so the plugin's lint cannot reach it).

## Running it

`.wp-env.json` at the repository root mounts this directory into both wp-env sites. wp-env mounts a mapped theme but never activates it, on a new environment or an existing one, so its `afterStart` script runs `wp theme activate resource-hub` on the dev and tests sites after every `pnpm env:start`. The script calls `wp-env run`, so it needs `wp-env` on `PATH`; `pnpm env:start` puts the workspace's copy there, while a bare `wp-env start` from a shell without it fails at that step. The PHPUnit bootstrap then reinstalls the tests site on core's test theme, `default`, so the Playwright fixture in `tests/e2e/fixtures.js` activates the theme again before any spec runs. Run `pnpm build` once before loading a page: without `build/`, `functions.php` registers nothing, Figtree's file is missing, and the pages render in the browser's defaults.

## Not built yet

Slice 5 continues in [issue #89](https://github.com/Colbitron/resource-hub-wp/issues/89):

- **`card.css` and the layout.** The theme loads no component stylesheet of its own yet: the block brings `card.css` where it is used, and the templates' layout (the shell's header and footer, the reading column) comes with them. `layout.contentSize` is `--rh-measure`, `65ch`, which core applies to each child of a constrained group, so a heading's column is measured in its own, larger `ch`; the templates should put the measure on a wrapper, as the front end does.
- **The System / Light / Dark control** the front end has in its footer. Until it lands, the CMS follows the system preference only.
- **The remaining templates:** single resource, archives and pages; `index.html` stands in for all of them.
- **Deploy:** CI syncs only the plugin to the host, so this theme is not on the hosted CMS yet, and the hosted 404 is still rendered with the host's current theme. The deploy must carry `build/` and may leave `package.json`, `scripts/` and `node_modules/` behind.

Issue #89's third note, the Site Editor revalidation notice, is settled: page editing stays in the post editor, and the Site Editor gets no notice (above).
