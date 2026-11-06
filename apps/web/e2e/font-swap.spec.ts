import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { mockCms } from "./mock-cms/client.mts";
import { platformFonts } from "./platform-fonts.mts";

/**
 * Figtree is loaded with `display: "swap"` (`app/fonts.ts`,
 * `packages/ui/DESIGN.md`, Consumers and loading): a file that lands after
 * the first paint replaces the fallback face, and that replacement must not
 * move the page. Figtree's file is held back for two seconds, as on a slow
 * first visit, so the first paint uses the fallback; the spec checks that it
 * did, then that Figtree is what draws the page once the file has landed,
 * and records every layout shift from the first paint until after the swap,
 * on the resource page and on a listing at 360 px, each with a title long
 * enough to wrap over several lines in the heading weight. A bold title is
 * where the fallback, calibrated on Figtree's regular weight, differs most in
 * width, so it is where a line can re-wrap when the face changes.
 *
 * Budget: CLS at most 0.05, Lighthouse's, on both pages. A heading's height
 * is recorded in the attachment but not asserted: with `swap` a title below
 * the fold may re-wrap when Figtree arrives (two card titles on the listing
 * did, measured with this delay), and CLS does not count what happens
 * outside the viewport, which is the risk `swap` accepts. The Lighthouse gate
 * never sees a late file, because the one it fetches lands before the first
 * paint. A last test proves that an undelayed page is drawn in Figtree.
 *
 * What the spec proves depends on the fallback the platform has. The
 * adjusted fallback face is `local("Arial")` with Figtree's metrics; on
 * macOS and Windows that is what the first paint uses. On Linux without
 * Arial (Playwright's image, and likely a CI runner) that face resolves to
 * nothing and the first paint uses the next family in `--rh-font-sans` that
 * the system has, unadjusted: in Playwright's image `system-ui` gives
 * WenQuanYi Zen Hei, and the listing's shift there was over a hundred times
 * the one with the adjusted Arial, though inside the budget. So on Linux the spec proves the
 * mechanism (the fallback first, Figtree after the file lands) and bounds
 * the shift of a fallback further from Figtree than a reader's, not the
 * shift a reader sees.
 */

const cms = mockCms();
const RUN = Date.now().toString(36);
const FONT_DELAY_MS = 2_000;
const LONG_TITLE = "How one change travels from the WordPress editor to a rebuilt page on the front end, step by step";
const CLS_BUDGET = 0.05;

/** Every heading a late font could re-wrap: the page's title and the cards' titles. */
const HEADINGS = "h1, .rh-card__title";

interface Shift {
  value: number;
  sources: string[];
}

declare global {
  interface Window {
    __rhShifts: Shift[];
  }
}

/** Collects layout shifts from the first paint on, before any page script runs. */
async function recordShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__rhShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: { node?: Node | null }[];
        };
        if (shift.hadRecentInput) continue;
        window.__rhShifts.push({
          value: shift.value,
          sources: (shift.sources ?? []).map((source) => {
            const node = source.node;
            if (!(node instanceof Element)) return node?.nodeName ?? "?";
            return `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(" ").join(".")}` : ""}`;
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** Holds back every font file `next/font` serves. */
async function delayFonts(page: Page): Promise<void> {
  await page.route("**/_next/static/media/*.woff2", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, FONT_DELAY_MS));
    await route.continue();
  });
}

/** Whether Figtree's face, the first family `next/font` set in `--rh-font-figtree`, has finished loading. */
function figtreeLoaded(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const families = getComputedStyle(document.documentElement).getPropertyValue("--rh-font-figtree");
    const family = families.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    const faces = [...document.fonts].filter((face) => face.family.replace(/^['"]|['"]$/g, "") === family);
    return faces.length > 0 && faces.every((face) => face.status === "loaded");
  });
}

function headingHeights(page: Page): Promise<number[]> {
  return page.locator(HEADINGS).evaluateAll((headings) => headings.map((heading) => Math.round(heading.getBoundingClientRect().height)));
}

/** Two animation frames: whatever the last change did has been laid out and painted. */
function settle(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** The variable file names itself by its default instance ("Figtree Light"). */
function expectFigtree(fonts: string[], what: string): void {
  expect(fonts.length, `${what} was drawn with no font`).toBeGreaterThan(0);
  for (const family of fonts) expect(family, `${what} was drawn in ${fonts.join(", ")}`).toMatch(/^Figtree\b/);
}

interface Measurement {
  cls: number;
  shifts: Shift[];
  heightsBefore: number[];
  heightsAfter: number[];
  fontsBefore: string[];
  fontsAfter: string[];
}

/**
 * Loads `path` with the font held back and measures from the first paint
 * until after the swap. `selector` is the title whose face is checked.
 */
async function measureLateFont(page: Page, path: string, selector: string): Promise<Measurement> {
  await page.setViewportSize({ width: 360, height: 740 });
  await recordShifts(page);
  await delayFonts(page);
  const fontLanded = page.waitForEvent("requestfinished", { predicate: (request) => request.url().endsWith(".woff2"), timeout: 15_000 });

  await page.goto(path, { waitUntil: "domcontentloaded" });
  await settle(page);
  expect(await figtreeLoaded(page), "Figtree was held back, so it has not loaded yet").toBe(false);
  const fontsBefore = await platformFonts(page, selector);
  expect(fontsBefore.length, "the title was drawn with no font").toBeGreaterThan(0);
  for (const family of fontsBefore) expect(family, "the first paint used the fallback face").not.toMatch(/^Figtree\b/);
  const heightsBefore = await headingHeights(page);

  await fontLanded;
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  // Shifts are reported a frame or so after they happen.
  await page.waitForTimeout(300);
  const heightsAfter = await headingHeights(page);
  const fontsAfter = await platformFonts(page, selector);

  const shifts = await page.evaluate(() => window.__rhShifts);
  const cls = shifts.reduce((total, shift) => total + shift.value, 0);
  return { cls, shifts, heightsBefore, heightsAfter, fontsBefore, fontsAfter };
}

async function report(testInfo: TestInfo, result: Measurement): Promise<void> {
  await testInfo.attach("late-font", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  testInfo.annotations.push({ type: "cls", description: result.cls.toFixed(4) });
}

test.beforeEach(async () => {
  await cms.reset();
});

test.describe("a late font at 360px, with Figtree held back for two seconds", () => {
  test("the resource page swaps to Figtree within the CLS budget", async ({ page, request }, testInfo) => {
    const slug = `font-swap-resource-${RUN}`;
    await cms.createResource({ title: LONG_TITLE, type: "article", slug, summary: "A resource whose title wraps over several lines at 360 px." });
    try {
      const result = await measureLateFont(page, `/resources/article/${slug}/`, "h1");
      await report(testInfo, result);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(LONG_TITLE);
      expect(result.heightsBefore[0], "the title wraps over several lines").toBeGreaterThan(80);
      expectFigtree(result.fontsAfter, "the title, after the file landed,");
      expect(result.cls, `layout shifts: ${JSON.stringify(result.shifts)}`).toBeLessThanOrEqual(CLS_BUDGET);
    } finally {
      // No later spec may be served a listing with this resource in it.
      await cms.reset();
      await clearAppCache(request);
    }
  });

  test("a listing whose first card has a long title swaps to Figtree within the CLS budget", async ({ page, request }, testInfo) => {
    const slug = `font-swap-listing-${RUN}`;
    await cms.createResource({ title: LONG_TITLE, type: "article", slug, summary: "A resource whose title wraps over several lines at 360 px." });
    await clearAppCache(request);
    try {
      const result = await measureLateFont(page, "/resources/", ".rh-card__title");
      await report(testInfo, result);
      await expect(page.locator(".rh-card__title").first()).toHaveText(LONG_TITLE);
      expectFigtree(result.fontsAfter, "the first card's title, after the file landed,");
      expect(result.cls, `layout shifts: ${JSON.stringify(result.shifts)}`).toBeLessThanOrEqual(CLS_BUDGET);
    } finally {
      // No later spec may be served a listing with this resource in it.
      await cms.reset();
      await clearAppCache(request);
    }
  });
});

test("without a delay the page is drawn in Figtree", async ({ page }) => {
  // A first load renders and stores the listing and puts the file in the
  // browser's cache, so the load measured is an ordinary one, with no cold
  // render's time in it; with `swap` the face is applied either way once
  // the file has loaded, so the warm load only keeps the check quick.
  await page.goto("/resources/");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.goto("/resources/");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await figtreeLoaded(page)).toBe(true);
  expectFigtree(await platformFonts(page, "h1"), "the listing's h1");
});
