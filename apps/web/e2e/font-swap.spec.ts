import { expect, test, type Page } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { mockCms } from "./mock-cms/client.mts";

/**
 * Loading Figtree never moves the page (`app/fonts.ts`, `packages/ui/DESIGN.md`,
 * Consumers and loading). Figtree's file is held back for two seconds, as on
 * a slow first visit, so the first paint uses the size-adjusted fallback
 * face; the spec then records every layout shift from that paint until after
 * the file has landed, on the resource page and on a listing at 360 px, each
 * with a title long enough to wrap over several lines in the heading weight.
 * A bold heading is where a fallback calibrated on Figtree's regular weight
 * differs most in width, re-wraps a line and pushes the page down: with
 * `display: "swap"` this spec measured two card titles on the listing going
 * from one line to two when the font arrived, which is why the font is
 * `optional`. The Lighthouse gate never sees this, because the file it
 * fetches lands before the first paint.
 *
 * Budget: CLS at most 0.05, Lighthouse's, and no heading's height changes,
 * which is what a re-wrapped line looks like even below the fold, where CLS
 * does not count it. A last test proves `optional` still shows Figtree when
 * the file is not held back, so the font is not dropped for everyone.
 */

const cms = mockCms();
const RUN = Date.now().toString(36);
const FONT_DELAY_MS = 2_000;
const LONG_TITLE = "How one change travels from the WordPress editor to a rebuilt page on the front end, step by step";

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

/** The font files Chromium actually drew the first `h1`'s text with (CDP's CSS.getPlatformFontsForNode). */
async function h1PlatformFonts(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "h1" });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    return fonts.filter((font) => font.glyphCount > 0).map((font) => font.familyName);
  } finally {
    await cdp.detach();
  }
}

function headingHeights(page: Page): Promise<number[]> {
  return page.locator(HEADINGS).evaluateAll((headings) => headings.map((heading) => Math.round(heading.getBoundingClientRect().height)));
}

/** Two animation frames: whatever the last change did has been laid out and painted. */
function settle(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

interface Measurement {
  cls: number;
  shifts: Shift[];
  before: number[];
  after: number[];
  h1Fonts: string[];
}

async function measureLateFont(page: Page, path: string): Promise<Measurement> {
  await page.setViewportSize({ width: 360, height: 740 });
  await recordShifts(page);
  await delayFonts(page);
  const fontLanded = page.waitForEvent("requestfinished", { predicate: (request) => request.url().endsWith(".woff2"), timeout: 15_000 });

  await page.goto(path, { waitUntil: "domcontentloaded" });
  await settle(page);
  expect(await figtreeLoaded(page), "Figtree was held back, so the first paint used the fallback face").toBe(false);
  const before = await headingHeights(page);

  await fontLanded;
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  // Shifts are reported a frame or so after they happen.
  await page.waitForTimeout(300);
  const after = await headingHeights(page);

  const shifts = await page.evaluate(() => window.__rhShifts);
  const cls = shifts.reduce((total, shift) => total + shift.value, 0);
  return { cls, shifts, before, after, h1Fonts: await h1PlatformFonts(page) };
}

test.beforeEach(async () => {
  await cms.reset();
});

test.describe("a late font at 360px, with Figtree held back for two seconds", () => {
  test("the resource page's long title moves nothing when the file lands", async ({ page }, testInfo) => {
    const slug = `font-swap-resource-${RUN}`;
    await cms.createResource({ title: LONG_TITLE, type: "article", slug, summary: "A resource whose title wraps over several lines at 360 px." });

    const result = await measureLateFont(page, `/resources/article/${slug}/`);
    await testInfo.attach("late-font", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(LONG_TITLE);
    expect(result.before[0], "the title wraps over several lines").toBeGreaterThan(80);
    expect(result.after, "no heading re-wrapped when the file landed").toEqual(result.before);
    expect(result.cls, `layout shifts: ${JSON.stringify(result.shifts)}`).toBeLessThanOrEqual(0.05);
  });

  test("a listing whose first card has a long title moves nothing when the file lands", async ({ page, request }, testInfo) => {
    const slug = `font-swap-listing-${RUN}`;
    await cms.createResource({ title: LONG_TITLE, type: "article", slug, summary: "A resource whose title wraps over several lines at 360 px." });
    await clearAppCache(request);
    try {
      const result = await measureLateFont(page, "/resources/");
      await testInfo.attach("late-font", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
      await expect(page.locator(".rh-card__title").first()).toHaveText(LONG_TITLE);
      expect(result.after, "no heading re-wrapped when the file landed").toEqual(result.before);
      expect(result.cls, `layout shifts: ${JSON.stringify(result.shifts)}`).toBeLessThanOrEqual(0.05);
    } finally {
      // No later spec may be served a listing with this resource in it.
      await cms.reset();
      await clearAppCache(request);
    }
  });
});

test("without a delay the page is drawn in Figtree", async ({ page }) => {
  await page.goto("/resources/");
  await page.evaluate(() => document.fonts.ready);
  expect(await figtreeLoaded(page)).toBe(true);
  // The variable file names itself by its default instance ("Figtree Light"); every glyph is from it.
  const fonts = await h1PlatformFonts(page);
  expect(fonts.length).toBeGreaterThan(0);
  for (const family of fonts) expect(family).toMatch(/^Figtree\b/);
});
