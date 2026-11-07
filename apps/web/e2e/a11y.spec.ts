import { expect, test } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { wcagViolations } from "./axe.mts";
import { mockCms } from "./mock-cms/client.mts";
import { SAMPLED_URLS } from "./sampled-urls.mts";

/**
 * The accessibility gate: a full axe scan of the sampled URLs
 * (`sampled-urls.mts`, shared with Lighthouse CI, which says what is and is
 * not sampled), in the light and the dark colour scheme, with every WCAG
 * 2.0, 2.1 and 2.2 level A and AA rule axe has. Zero violations, in both
 * schemes, on every sampled URL.
 *
 * Both schemes, because the shared tokens switch on `prefers-color-scheme`
 * and a contrast failure in one says nothing about the other. Each scheme is
 * emulated before the page loads, so the first paint is already in it.
 *
 * axe sees what a browser renders: it checks contrast against computed
 * colours, so it covers the tokens as the pages use them. It cannot judge
 * reading order, meaningful alt text or focus order end to end; the specs
 * for each route keep those checks (`card.spec.ts`, `listings.spec.ts`,
 * `resource-page.spec.ts`).
 */

const SCHEMES = ["light", "dark"] as const;

const cms = mockCms();

test.beforeEach(async ({ request }) => {
  await cms.reset();
  // Listings outlive a reset in the app's cache (e2e/README.md); clear them
  // so every scan sees the seed.
  await clearAppCache(request);
});

for (const { label, path, status } of SAMPLED_URLS) {
  test.describe(`${label} (${path})`, () => {
    for (const colorScheme of SCHEMES) {
      test(`has no WCAG A or AA violation in the ${colorScheme} scheme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(status);
        // Both 404s carry the site's page in their HTML (errors.spec.ts), but a
        // data-decided one hands it to `app/not-found.tsx` on hydration, so
        // wait for a heading, which every sampled page has, and the load
        // before scanning.
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForLoadState("load");
        expect(await wcagViolations(page)).toEqual([]);
      });
    }
  });
}
