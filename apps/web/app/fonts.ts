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
 * - `display: "swap"`: text paints in the fallback face at once and swaps
 *   when the file lands, so the brand face always shows. Measured with
 *   Lighthouse CI (mobile, median of three) on 2026-11-06 against the
 *   design-gates baseline: the preloaded 20 KB file left LCP unchanged on
 *   five of the seven sampled URLs (903 ms), moved `/resources/page/2/` by
 *   5 ms (2169 to 2174) and the resource page by 79 ms (2168 to 2247), all
 *   under the 2500 ms budget; `optional` measured the same (2173 and 2248),
 *   so it would buy nothing in the lab and would drop the face on a slow
 *   first visit. The cost that remains is the preload sharing the first
 *   bytes with the page's image, not the swap.
 * - `adjustFontFallback: "Arial"`: a second `@font-face` for the fallback,
 *   Arial with size, ascent, descent and line-gap overrides matched to
 *   Figtree's metrics, so the swap moves nothing (CLS stays at 0).
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
