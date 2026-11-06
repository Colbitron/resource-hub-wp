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
 * - `display: "optional"`: the browser gives the preloaded file a very
 *   short block period and, if it has not landed by then, keeps the fallback
 *   face for the rest of that page view and uses Figtree from the cache on
 *   the next one. Nothing can move after the first paint. `swap` was tried
 *   first and measured with the file held back two seconds
 *   (`e2e/font-swap.spec.ts`): the resource page's title kept its lines, but
 *   on a listing at 360 px two card titles re-wrapped from one line to two
 *   when Figtree arrived, because the fallback is calibrated on the regular
 *   weight and titles are bold. A bold fallback face hand-tuned to Figtree's
 *   heading width would narrow the gap without closing it, since any width
 *   difference can move a word across a line end. In the lab the two values
 *   gave the same LCP (the file is preloaded and lands before the first
 *   paint), so `optional` costs only the face on a slow first visit; the
 *   numbers are in the change's pull request, not here, so they cannot go
 *   stale.
 * - `adjustFontFallback: "Arial"`: a second `@font-face` for the fallback,
 *   Arial with size, ascent, descent and line-gap overrides matched to
 *   Figtree's metrics, so a page that keeps the fallback looks as close to
 *   Figtree as Arial can.
 * - `variable`: the loader sets `--rh-font-figtree` on the element that
 *   carries its class to the two generated family names (Figtree, then the
 *   adjusted fallback), and `tokens.css` puts that variable first in
 *   `--rh-font-sans`, so every consumer's CSS names the font the same way.
 */
export const figtree = localFont({
  src: "../../../packages/ui/fonts/figtree-latin-wght-normal.woff2",
  weight: "300 900",
  style: "normal",
  display: "optional",
  preload: true,
  adjustFontFallback: "Arial",
  variable: "--rh-font-figtree",
});
