import { expect, test } from "@playwright/test";

import { platformFonts } from "./platform-fonts.mts";

/**
 * Pixel baselines of the design specimen (`app/fixtures/specimen/`), the page
 * that shows every shared token, every component and the states between
 * them (focus, selected filters, pagination's ends, an empty listing): at
 * 360 and 1280 px, in the light and the dark scheme, with reduced motion;
 * and, for each, a crop of the focused link and its ring, compared with a
 * tolerance of a few pixels. A change to a token, a component's markup or
 * its CSS moves pixels here, so every design change shows its cost as a diff
 * in review.
 *
 * Only the `screenshots` project runs this file, and that project only
 * exists when `e2e/screenshots.mts` has started Chromium in Playwright's
 * official Linux Docker image (`pnpm web:test:screenshots`), so every
 * baseline is rendered by the same browser with the same fonts, on a laptop
 * and in CI. Baselines are in `e2e/__screenshots__/`; regenerate them with
 * `pnpm web:test:screenshots:update` and review the diff like code.
 */

const SPECIMEN_PATH = "/fixtures/specimen/";

const WIDTHS = [360, 1280] as const;
const SCHEMES = ["light", "dark"] as const;
/** Pixels around the focused link's box in its own shot: the ring's 2 px offset and 3 px width, and a band of surface. */
const FOCUS_MARGIN = 10;
/**
 * Differing pixels the focus ring's crop may have: room for a glyph edge or
 * the ring's rounded corner to anti-alias a pixel apart between amd64
 * emulation on Apple silicon (where the baselines were made) and CI's
 * native amd64, and far under the 440 pixels a ring one pixel narrower moves.
 */
const FOCUS_MAX_DIFF_PIXELS = 10;

for (const width of WIDTHS) {
  for (const colorScheme of SCHEMES) {
    test.describe(`at ${width}px in the ${colorScheme} scheme`, () => {
      test.use({ viewport: { width, height: 800 }, colorScheme });

      test("the specimen matches its baseline", async ({ page }) => {
        // Figtree is `display: optional` (app/fonts.ts): a file that misses
        // its short block period, which emulation can make it do, leaves the
        // page in the fallback face for good. One load first puts the file in
        // the browser's cache, so the captured load always draws Figtree.
        await page.goto(SPECIMEN_PATH);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.goto(SPECIMEN_PATH);
        // Every card image is eager; wait until each has decoded, and for the
        // fonts, so the capture never catches a half-loaded page.
        const images = page.locator("img");
        await expect
          .poll(() =>
            images.evaluateAll((nodes) =>
              nodes.every((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0),
            ),
          )
          .toBe(true);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        // A page left in the fallback face would fail below as thousands of
        // differing pixels; say what went wrong instead.
        const headingFonts = await platformFonts(page, "h1");
        expect(headingFonts.length, "the specimen's h1 was drawn with no font").toBeGreaterThan(0);
        for (const family of headingFonts) {
          expect(family, `the specimen was drawn in ${headingFonts.join(", ")}, not Figtree: the font missed its block period`).toMatch(/^Figtree\b/);
        }
        // The states section's link, focused as a keyboard would, so the
        // baseline shows the focus ring (`:focus-visible`).
        const focused = page.locator("#specimen-focus");
        await focused.focus();
        await expect(focused).toBeFocused();
        expect(await focused.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
        // In the Docker image Chromium resolves the generic `monospace` to
        // WenQuanYi Zen Hei Mono for the first layout and to Liberation Mono
        // once a screenshot has re-applied the page's emulation, which rewraps
        // the token labels and the prose's code (measured with CDP's
        // CSS.getPlatformFontsForNode; the same order every run). One capture
        // first, thrown away, so the baseline is always the settled layout.
        await page.screenshot({ fullPage: true });
        // Soft, so the focus ring's own shot below is still compared, and its
        // diff written, when the whole page differs.
        await expect.soft(page).toHaveScreenshot(`specimen-${width}-${colorScheme}.png`, { fullPage: true });

        // The focus ring alone, compared with a tolerance of
        // FOCUS_MAX_DIFF_PIXELS: its colour (`--rh-color-focus`), width
        // (`--rh-focus-width`) and offset are a few hundred pixels of a page
        // of millions, under any useful tolerance for the whole page. The
        // crop is the link's box grown by FOCUS_MARGIN on every side, enough
        // for the 2 px offset, the ring and a band of the surface around it,
        // so a wider or further ring moves pixels inside it.
        await expect(focused).toBeFocused();
        await focused.scrollIntoViewIfNeeded();
        const box = await focused.boundingBox();
        if (box === null) throw new Error("The focused link has no box.");
        await expect(page).toHaveScreenshot(`focus-ring-${width}-${colorScheme}.png`, {
          clip: {
            x: Math.floor(box.x - FOCUS_MARGIN),
            y: Math.floor(box.y - FOCUS_MARGIN),
            width: Math.ceil(box.width + 2 * FOCUS_MARGIN),
            height: Math.ceil(box.height + 2 * FOCUS_MARGIN),
          },
          maxDiffPixels: FOCUS_MAX_DIFF_PIXELS,
          threshold: 0,
        });
      });
    });
  }
}
