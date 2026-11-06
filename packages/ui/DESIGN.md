# Resource Hub design system

The one written home of the visual system shared by the Next.js front end (`apps/web/`), the WordPress plugin's block and the planned CMS block theme. Three things are true at once and each lives in one place: the **intent and the rules** are here; the **values** are in [`tokens.css`](tokens.css) beside this file (this document names tokens, and gives a value in prose only where it explains a rule, such as the 4 px spacing step or the 360 px phone width; where the two differ, `tokens.css` is right and this document is fixed); and the **rendered truth** is the front end's specimen page, `apps/web/app/fixtures/specimen/`, which shows every token and every component with fixture content and is captured by the screenshot gate. When the three disagree, fix the one that is wrong and rerun the gates in [Changing the system](#changing-the-system).

The section order follows Google Labs' DESIGN.md convention (Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts), with four sections of our own where that convention has nothing to say: the colour scheme, motion, how each consumer loads the system, and how to change it. A test, `test/design-doc.test.js`, fails when `tokens.css` declares a `--rh-*` token this document does not mention, when this document names one that does not exist, or when the sections drift from that order.

## Overview

Resource Hub is a filterable library of resources, published by Colbination and rendered by a headless WordPress and Next.js pair; it is a demonstration of that pattern, written fresh. It takes its look from the publisher's own site: warm paper rather than white, ink rather than black, one friendly geometric sans for everything, and five small accents of colour used sparingly, as marks and never as the voice. The two sites should read as siblings.

The tone is editorial and quiet. Text carries the page: hierarchy comes from weight, size and a few hairlines rather than from boxes, shadows or colour fields. Density is reading-first: a prose measure of about sixty-five characters, generous line height, one gutter on a phone and no horizontal scroll at 360 px. Everything is server-rendered HTML with plain CSS; the design never depends on client-side JavaScript except for the theme control described below, which degrades to the system preference without it.

The library's own name stays "Resource Hub"; Colbination is the publisher named in the footer and the metadata, not a second brand in the header.

## Colors

Every colour is a role, named for what it does and never for its value, and every role is a `light-dark()` pair so one declaration serves both schemes.

| Token | Role |
|---|---|
| `--rh-color-text` | Ink: body text, headings, the current filter's fill, and the neutral mark |
| `--rh-color-text-muted` | Secondary text: meta lines, summaries, captions, the footer, hover borders |
| `--rh-color-surface` | The page: the body background and the card |
| `--rh-color-surface-raised` | An inset surface a step away from the page: topic chips, code, the image placeholder |
| `--rh-color-border` | Decorative hairlines, as translucent ink so one value sits on either surface: dividers, the card's outline, a table's rules, the card's topic labels |
| `--rh-color-border-strong` | The boundary of a control whose edge is the only thing that shows it is one: the filter chips, the pagination links and the resource page's topic chips; opaque, in the ink family |
| `--rh-color-accent` | Links, and the skip link's background: cobalt, the brand's link colour |
| `--rh-color-accent-text` | Text on `--rh-color-accent` |
| `--rh-color-focus` | The focus ring: cobalt in light, lemon in dark |

**Links are cobalt**, in both schemes, underlined, never colour alone.

**The five brand accents** are tokens of their own, `--rh-mark-coral`, `--rh-mark-cobalt`, `--rh-mark-lemon`, `--rh-mark-mint` and `--rh-mark-grape`, and they are for **small marks only**: a dot beside a printed name, a brand mark, a hairline of colour. They are never text, never a text background and never the only thing that distinguishes two states, because in the light scheme lemon, coral and mint sit under the 3:1 non-text line against the surface, and grape under it against the raised surface (2.77:1). Cobalt, lemon and mint are lifted a step in the dark scheme so they read on ink; coral and grape have one brand value, written as a `light-dark()` pair of that value twice so that every colour token has the same shape.

**Each resource type has an accent.** The mark goes beside the type's printed name, so the name says what the colour only hints at, and a mark is never placed beside a link, because the cobalt dot would read as part of it. The table is `apps/web/lib/type-accents.ts`, keyed by the `resource_type` term's ID, which is the same on the hosted CMS, the local wp-env and the mock CMS's seed; a unit test checks every row against the seed.

| Term ID | Slug | Accent |
|---|---|---|
| 3 | `article` | mint |
| 4 | `ebook` | grape |
| 5 | `webinar` | coral |
| 6 | `podcast` | lemon |
| 7 | `case-study` | cobalt |

A type the table does not know, or whose ID now carries a different slug, gets a **neutral mark** in the ink (`--rh-color-text`). Adding a type is therefore a development change, not an editorial one: the term is created in the CMS and its accent row ships in the same change and the same deploy, so a new type is never coloured by accident. Rendering the marks on cards and resource pages is still to be built; the table and the tokens come first so the rule exists before anything draws it.

**Borders are decorative or they mark a control.** The hairline, `--rh-color-border`, is decoration: it separates things that are already told apart by their text and space, so it may sit far under 3:1, and it is never the only edge of something a reader can activate. Wherever a control's edge is what shows it is a control (a filter chip, a pagination link, a topic chip on the resource page), that edge is `--rh-color-border-strong`, which reaches 3:1 against both surfaces (WCAG 1.4.11). The card keeps the hairline because its title is an underlined link, and the card's topic labels keep it because they are not links.

**Contrast is a test, not a table.** WCAG 2.2 AA: 4.5:1 for every pair of text on a background, and 3:1 for the focus ring and a control's boundary against both surfaces, in both schemes. `test/contrast.test.js` parses `tokens.css`, resolves each scheme and asserts every pair (text and muted text on the page and on the raised surface, links on both, text on the accent, the inverted current state, the focus ring and the strong border), so the ratios are never written down to go stale. Every colour token is in an asserted pair or in the test's commented list of decorative exemptions, which is the hairline and the marks; their ratios are printed, not asserted, with a translucent colour composited over the surface first. The test also refuses a token declared outside the one `:root` block, so a scoped override cannot carry a value it never measured. One open point for the owner: in the light scheme lemon is the weakest mark by far, with coral and mint under 3:1 too, and grape under it on the raised surface (2.77:1). Clearing 3:1 would mean darkening those three light values away from the brand's; the dark scheme is fine as it is.

## Theme and colour scheme

The reader's system preference is the default. `tokens.css` sets `color-scheme: light dark` on `:root` and writes every colour with `light-dark()`, so the browser picks the side; there is no `prefers-color-scheme` media query and no second copy of the values.

A **System / Light / Dark control** (to be built in a later branch) lets a reader override that. Its rules are fixed now: the default is System; the choice is stored in the browser, never on a server; it is applied before first paint by setting `color-scheme` on `<html>` to `light` or `dark`, or removing it for System, which every `light-dark()` token follows at once with no transition; and the control is hidden when JavaScript is off, because without it the preference cannot be applied and the system choice already works. A media query could not have been overridden this way, which is why the tokens use `light-dark()` and the contrast test refuses a media query.

The CMS block theme, when it exists, uses the same mechanism on its own pages, so an editor's preview looks like the front end in either scheme.

## Typography

**Figtree, and only Figtree**, for body text and headings alike: one variable file on the weight axis, latin subset, in [`fonts/`](fonts/) with its SIL Open Font License beside it (`fonts/LICENSE-Figtree.txt`). The file is the official Google Fonts release, taken byte for byte from `@fontsource-variable/figtree`; nothing is ever requested from Google by a visitor's browser. There is no italic file: the few italics in a body are synthesised by the browser, and the italic face can be added beside this one if that ever shows. The system stack behind it exists only for the moment before the file lands and for a consumer that has not loaded it.

| Token | Role |
|---|---|
| `--rh-font-sans` | The one family stack: Figtree first, through `--rh-font-figtree` (see [Consumers and loading](#consumers-and-loading)), then the system sans, which is all a consumer that registers no Figtree face gets (the plugin's block, once it loads the tokens) |
| `--rh-weight-heading` | Headings and the site name: heavier than body text |
| `--rh-tracking-heading` | Headings: slightly tighter than body text |
| `--rh-text-sm`, `--rh-text-base`, `--rh-text-md`, `--rh-text-lg`, `--rh-text-xl`, `--rh-text-2xl` | The size scale: meta and chips, body, the summary and card titles, `h3`, `h2`, `h1` |
| `--rh-leading-tight`, `--rh-leading-body` | Line height for headings and for everything else |

Body text is the regular weight; labels and strong text are semibold; headings, the card title and the site name take the heading weight and tracking. Headings carry their hierarchy in size and weight alone, with no colour. The page title is the page's only `h1`; a body's headings start at `h2`.

## Layout

Spacing is one scale on a 4 px step, `--rh-space-1`, `--rh-space-2`, `--rh-space-3`, `--rh-space-4`, `--rh-space-5`, `--rh-space-6`, `--rh-space-7` and `--rh-space-8`, and every margin, padding and gap in a component is one of those steps: the small ones inside a component (a chip's padding, the gap between a card's lines), `--rh-space-4` for the gutter and a card's padding, the large ones between sections and around `main`. There are no fixed breakpoints: grids are fluid (`.rh-card-grid` fills the width with columns of at least `17rem`, one column on a phone), lists wrap, and the two measures do the rest. `--rh-measure` is the prose line length, used by every paragraph and by the single-resource and page columns; `--rh-measure-wide` is the content width of the shell, centred, with one gutter of `--rh-space-4` on both sides at every width. The page must never scroll sideways at 360 px; the specimen's own check and the axe scan hold that.

## Elevation & Depth

The system is flat. Depth is shown by surface and hairline, not by shadow: the page is `--rh-color-surface`, an inset such as a chip, a code block or the box an image loads into is `--rh-color-surface-raised`, and edges are `--rh-color-border` at `--rh-border-width`, or `--rh-color-border-strong` where the edge marks a control (see [Colors](#colors)). A hover darkens a border to `--rh-color-text-muted`; the current filter and the current page invert, ink behind surface-coloured text. There are no shadow tokens today. If a later direction wants a resting shadow or a lift on hover, it is added as a token here and in `tokens.css` first, and stays subtle enough to vanish in the dark scheme.

## Shapes

Corners are nearly square: `--rh-radius-sm` for chips and inline code, `--rh-radius` for cards, images, code blocks and the skip link. The focus ring is an outline of `--rh-focus-width` in `--rh-color-focus`, offset by two pixels so it never touches the thing it marks; on a card it is drawn around the whole card through the stretched link's overlay. No pills and no fully round shapes, except a mark's dot.

## Motion

There is no motion today: no shipped stylesheet declares a `transition` or an `animation`. This is the rule for the first that does. Motion is CSS transitions only, on `transform`, `opacity` and colour, and nothing moves that does not respond to the reader. About 200 ms is the guide, not a rule: a hover or a focus settles in that order, and nothing runs longer than a glance. Under `prefers-reduced-motion: reduce` every transition and animation is off, with no exception for "small" ones: `apps/web/test/reduced-motion.test.ts` fails any rule in a shipped stylesheet that sets a `transition*` or `animation*` property unless a rule for the same selector in the same file sets the shorthand to `none` inside `@media (prefers-reduced-motion: reduce)`. A theme switch is instant, never cross-faded. No JavaScript animation, no scroll-driven effects, no autoplay.

## Components

The shared stylesheets are the contract: `tokens.css`, and one file per shared component, each building only on the tokens and defining no colour or size of its own. `card.css` holds `.rh-card` and its parts (`__media`, `__body`, `__meta`, `__type`, `__title`, `__link`, `__summary`, `__topics`, `__topic`) and `.rh-card-grid`, with the markup it expects in its header comment; the related list's stylesheet joins it when that block's styles move here. The front end's own classes (`rh-shell`, `rh-listing`, `rh-filters`, `rh-pagination`, `rh-prose`, `rh-resource`, `rh-page`, `rh-not-found`) are not contract and live in `apps/web/components/*.css`.

States are the same everywhere: `:focus-visible` draws the ring; links underline on hover, with the offset set once; the current filter and page use `aria-current` and the inverted fill, and under forced colours an outline instead. The card is one link through the stretched-link pattern: the title's link is its only interactive element and its `::after` covers the card. The trade-off is that the summary and the topics cannot be selected with the mouse, accepted because the card leads to the page that holds the same text; the alternative, if selection is ever wanted, is to lift the summary above the overlay at the cost of a click on it no longer navigating.

The type mark, when built, is a small dot of the type's accent before the printed type name, in the card's meta line and the resource page's header, and never in a line that holds a link.

## Consumers and loading

Every consumer takes the package through the pnpm workspace as `@colbitron/resource-hub-ui`; it is never published. `tokens.css` is loaded before any component stylesheet, and each stylesheet is loaded only where its markup is rendered.

- **The front end.** `components/Shell.tsx` imports `tokens.css` and the app's own `shell.css`, and the root layout renders the shell around every page; no stylesheet is imported from `layout.tsx`, and each component imports its own CSS (`ResourceCard` imports `card.css`). The font is loaded by `app/fonts.ts` with `next/font/local`: the file from `fonts/` is served from the app's static assets under a hashed name, preloaded on every route, with `font-display: optional` and a size-adjusted Arial fallback face. `optional` because a late swap re-wraps bold titles: the fallback is calibrated on the regular weight, and with `swap` and the file held back two seconds, card titles on a listing at 360 px went from one line to two when Figtree arrived. With `optional` the file is used only if it lands within the browser's short block period, which a preloaded 20 KB file does on any ordinary connection, and otherwise the page keeps the fallback until the next page view takes Figtree from the cache, so nothing moves after the first paint. A hand-tuned bold fallback face was rejected because it narrows the width difference without removing it. `e2e/font-swap.spec.ts` holds the file back and checks that no heading moves, and checks that an undelayed page is drawn in Figtree. The loader sets `--rh-font-figtree` on `<html>` to its two generated family names, and `--rh-font-sans` in `tokens.css` reads that variable first, so no stylesheet needs to know the generated names; the layout applies that one class, because a variable read on `:root` has to be set on `<html>`.
- **The block (not wired yet).** The plugin's `resource-hub/related-resources` block loads none of this package today: its `block.json` has no `style`, `editorStyle` or `viewStyle`, and nothing in the plugin enqueues `tokens.css` or a component stylesheet, so in the editor and on the CMS's own pages the block renders with whatever the active theme gives it. The wiring is planned with the shared related-list stylesheet (`related.css`, which does not exist yet; see [Components](#components)) and the slice-5 block theme: `block.json` will list `tokens.css` first and the component's stylesheet after it, so the block gets the same colours, sizes and spacing where it is used and nowhere else. The front end never renders the block's own HTML for it (it swaps the marker for its own component), so readers of the site are not affected. Figtree will come from the theme, not the plugin; until then a consumer that registers no Figtree face gets the system fallback in `--rh-font-sans`.
- **The block theme (planned).** `theme.json` registers Figtree from the same file (copied into the theme at build or deploy time, since `theme.json` resolves `file:./` relative to itself) under the plain family name `Figtree`, and leaves `--rh-font-figtree` unset, so `--rh-font-sans` falls back to that name. The copy carries `LICENSE-Figtree.txt` beside the font file, as the licence requires, and the theme records the file's SHA-256 so a test can prove the copy is byte for byte the one in `fonts/`. Its palette, scale and spacing are the tokens, and a parity test compares the two when the theme exists.

## Do's and Don'ts

- **Do** build on tokens; **don't** write a colour, size or space as a raw value in a component stylesheet.
- **Do** import a stylesheet from the component that renders its markup; **don't** import one from `layout.tsx`.
- **Do** print the type's name beside its mark; **don't** use a mark as text, as a text background, or beside a link.
- **Do** underline links; **don't** rely on colour alone for any state.
- **Do** write every colour as a `light-dark()` pair; **don't** add a `prefers-color-scheme` media query.
- **Do** keep Figtree the only typeface; **don't** add a web font, and **don't** let a browser request anything from Google.
- **Do** keep motion to short CSS transitions, all off under reduced motion; **don't** animate with JavaScript.
- **Do** keep plain CSS with BEM-ish class names under the `rh-` prefix; **don't** add a framework, a preprocessor, CSS-in-JS or shared JavaScript. Utility frameworks and CSS Modules generate or rewrite class names at build time, and the markup WordPress renders in PHP could not share them, so the contract's class names stay plain.
- **Do** treat a token or class rename as a contract change made on both sides in one pull request.

## Changing the system

1. Change the value in `tokens.css`, or add the token there. A new token goes into the specimen's list (`apps/web/app/fixtures/specimen/tokens.ts`) and onto the page; `apps/web/test/specimen-tokens.test.ts` fails until it does.
2. Say what it is for in this document; `test/design-doc.test.js` fails until it does.
3. Run the package's tests from the repository root, `pnpm test:schemas`, which now also runs the contrast and design-doc tests, and the front end's `pnpm web:test`.
4. Regenerate the specimen baselines with `pnpm web:test:screenshots:update` and read the diff images like code: every design change shows its cost there.
5. Run the rest of the gate: `pnpm web:typecheck`, `pnpm web:lint`, `pnpm web:test:e2e` (which includes the axe scan of every template in both schemes), `pnpm web:test:screenshots` and `pnpm web:test:lighthouse` (mobile; performance at least 0.95, accessibility 1, LCP at most 2500 ms, CLS at most 0.05, TBT at most 200 ms). A budget or a rule that fails is a finding to fix in the design, never a threshold to loosen.

A rename of a token or a class is a contract change: both sides in one pull request, and additive where a consumer could be a deploy behind. A decision that changes the direction of the system (a new typeface, a different scheme mechanism) is recorded as an ADR; everything else is recorded here.
