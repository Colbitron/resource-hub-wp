---
status: accepted
date: 2026-11-05
---

# Styling is plain CSS on shared tokens, reaching pages through a component

The front end and the CMS render the same resource card and related list, and the planned CMS theme ([ADR 0031](0031-cms-theme-pages-are-for-logged-in-users.md)) must look like the front end. The styles that make that true live in the shared package, `@colbitron/resource-hub-ui` ([ADR 0041](0041-the-shared-package-is-a-workspace-dependency.md)), as plain CSS: `tokens.css` holds design tokens as custom properties on `:root`, and one file per component (`card.css` now, `related.css` when the related list lands) builds on them and defines no colour or size of its own. There is no CSS framework, no preprocessor, no CSS-in-JS and no web font: the type stacks are system fonts, so a page pays no font request and no build step for its styles.

The tokens and the class names are part of the contract. Tokens are prefixed `--rh-` and named for their role (`--rh-color-text-muted`, `--rh-space-4`, `--rh-measure`), never for their value. Class names are BEM-ish under an `rh-` prefix: `.rh-card`, `.rh-card__media`, `.rh-card__title`, `.rh-card__link`, with the block's markup written in the stylesheet's header comment. WordPress and Next.js render that markup from their own code, so a rename is a contract change made on both sides in one pull request, like a schema change ([ADR 0010](0010-contract-as-json-schema-in-a-shared-package.md)).

Dark mode follows the reader's `prefers-color-scheme`: `tokens.css` redefines the colour tokens under that media query and sets `color-scheme: light dark`, and no component stylesheet mentions a scheme. There is no theme toggle and no stored preference. Every text-on-background pair in both schemes meets WCAG AA; the ratios at the time of writing are below.

Each consumer loads a stylesheet only where it is used, and never from `layout.tsx` ([ADR 0028](0028-shared-styles-in-a-private-github-package.md), kept by ADR 0041). The tokens still have to reach every page, because the shell's own header, footer and skip link are built on them. The front end resolves this with a `Shell` component in `components/`: it imports `tokens.css` and the app's own `shell.css`, and the root layout renders `<Shell>` around every page with no stylesheet import of its own. The rule holds literally, because the component that imports the tokens is the one that uses them, and it holds in spirit, because what reaches every page is the one stylesheet every page needs, not a bundle of every component's CSS. `card.css` is imported by `ResourceCard`, so a page without a card does not load it.

## Contrast, WCAG AA

| Pair | Light | Dark |
|---|---|---|
| text on surface | 16.39 | 14.79 |
| text on raised surface | 14.86 | 13.12 |
| muted text on surface | 6.11 | 7.95 |
| muted text on raised surface | 5.55 | 7.05 |
| accent (links) on surface | 8.16 | 8.52 |
| accent on raised surface | 7.40 | 7.56 |
| accent text on accent | 8.16 | 8.34 |
| focus ring against surface (non-text, 3:1) | 8.16 | 8.52 |
| focus ring against raised surface (non-text, 3:1) | 7.40 | 7.56 |

## Considered options

- **A utility framework (Tailwind).** The default of `create-next-app`. Rejected: the CMS's block styles and the planned theme cannot consume utility classes without a build step on the WordPress side, and the shared contract would be class soup rather than a short list of names. The card has a dozen rules; a framework would add a dependency and a `postcss` step for less CSS than its config.
- **CSS Modules in the front end.** Scoped and idiomatic in Next.js. Rejected: the hashed class names cannot be shared with WordPress, which renders the same markup from PHP, so the two sides would drift, which is what the package exists to prevent.
- **A theme toggle beside `prefers-color-scheme`.** Rejected for now: it needs client JavaScript and stored state for a reading-focused site that has neither; the media query covers what the reader has already chosen in the operating system.
- **Importing `tokens.css` from `layout.tsx`.** The one place that reaches every page. Rejected: it breaks the rule that shared CSS is imported from the component that uses it, and would invite the component stylesheets to follow it there.

## Consequences

- `tokens.css` must be loaded before any component stylesheet; in the front end the shell guarantees it, and in WordPress `block.json` lists it first.
- Test-only pages that render components with fixture props live under `apps/web/app/fixtures/` as `page.fixture.tsx`, a route only when `next.config.ts` adds that extension to `pageExtensions` under `RH_FIXTURES=1`, which Playwright's web server sets. A production build never includes them. This is the Playwright route rather than a Vitest render because the checks (skip link, focus order, horizontal overflow, aspect ratio) need a real layout engine.
- Adding a component stylesheet means a new `exports` entry in `packages/ui/package.json` and a header comment with the markup it expects.
- `next/image` with explicit `width`, `height` and `sizes` inside a media box with a fixed `aspect-ratio`, so a late image moves nothing ([ADR 0039](0039-vercel-image-optimizer.md)).
- The whole card is clickable through the stretched-link pattern: the title's link is the card's only interactive element, and its `::after` covers the card. The cost is that the overlay sits above the summary and the topics, so their text cannot be selected with the mouse. That is accepted, because the card links to the page that holds the same text. The alternative, if selection is ever wanted, is to lift `.rh-card__summary` above the overlay (`position: relative; z-index: 1`): its text becomes selectable, but a click on it no longer navigates. `card.css` records the same trade-off in its header comment.
