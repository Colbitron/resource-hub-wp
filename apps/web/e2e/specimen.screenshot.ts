import { expect, test } from "@playwright/test";

/**
 * Pixel baselines of the design specimen (`app/fixtures/specimen/`), the page
 * that shows every shared token, every component and the states between
 * them (focus, selected filters, pagination's ends, an empty listing): at
 * 360 and 1280 px, in
 * the light and the dark scheme, with reduced motion. A change to a token,
 * a component's markup or its CSS moves pixels here, so every design change
 * shows its cost as a diff in review.
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

for (const width of WIDTHS) {
  for (const colorScheme of SCHEMES) {
    test.describe(`at ${width}px in the ${colorScheme} scheme`, () => {
      test.use({ viewport: { width, height: 800 }, colorScheme });

      test("the specimen matches its baseline", async ({ page }) => {
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
        await expect(page).toHaveScreenshot(`specimen-${width}-${colorScheme}.png`, { fullPage: true });
      });
    });
  }
}
