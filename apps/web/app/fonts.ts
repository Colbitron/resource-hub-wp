import localFont from "next/font/local";

/**
 * Figtree, the site's one typeface (`packages/ui/DESIGN.md`): the variable
 * weight file the shared package holds, served by Next.js from
 * `/_next/static/media/` with a hashed name and an immutable cache header.
 * `next/font/local` writes the `@font-face` itself and preloads the file
 * from every route, since the root layout is what applies the class; the
 * browser never asks Google for anything.
 *
 * - `weight: "300 900"`: the file's whole weight axis, so body text and the
 *   heavier headings come from the one request.
 * - `display: "swap"`: the page is drawn in the fallback face until the
 *   file lands and in Figtree from then on, on the first visit as on every
 *   other. The preloaded file normally lands just before the first paint,
 *   which is the race `optional` loses: under `optional` a file that misses
 *   the browser's short block period leaves the fallback in place for the
 *   whole document, and an App Router navigation keeps that document, so a
 *   slow first visit can stay in the fallback until a full reload. Measured
 *   on slow mobile profiles, `swap` showed Figtree on the first paint of
 *   almost every cold load, where `optional` dropped it on most cold loads
 *   over 3G, with the same LCP and no measured layout shift (`packages/ui/DESIGN.md`,
 *   Font display, has the table). The cost is a file that arrives
 *   after the first paint: titles are bold and the fallback is calibrated on
 *   the regular weight, so a title can re-wrap when Figtree replaces it.
 *   `e2e/font-swap.spec.ts` holds the file back two seconds and keeps the
 *   layout shift that causes within budget. The choice is settled.
 * - `adjustFontFallback: "Arial"`: a second `@font-face` for the fallback,
 *   Arial with size, ascent, descent and line-gap overrides matched to
 *   Figtree's metrics, so the fallback text takes nearly the space Figtree
 *   will, and a page drawn in it looks as close to Figtree as Arial can.
 * - `variable`: the loader sets `--rh-font-figtree` on the element that
 *   carries its class to the two generated family names (Figtree, then the
 *   adjusted fallback), and `tokens.css` puts that variable first in
 *   `--rh-font-sans`, so every consumer's CSS names the font the same way.
 */
export const figtree = localFont({
  src: "../../../packages/ui/fonts/figtree-latin-wght-normal.woff2",
  weight: "300 900",
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: "Arial",
  variable: "--rh-font-figtree",
});
