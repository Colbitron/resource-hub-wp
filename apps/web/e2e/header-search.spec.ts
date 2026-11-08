import { expect, test, type Locator, type Page } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { wcagViolations } from "./axe.mts";
import { mockCms } from "./mock-cms/client.mts";

/**
 * The header's search control (`components/HeaderSearch.tsx`; issue #115;
 * `packages/ui/DESIGN.md`, "Brand"), against the built app:
 *
 * - without JavaScript, a plain link to `/search/` named "Search" that
 *   reaches the page, and on the search page a link to the page's field;
 * - with JavaScript, a disclosure button (`aria-expanded`, `aria-controls`)
 *   that opens and closes by mouse and by Enter and Space, moves focus to
 *   the bar's field on opening, closes on Escape from the field or the
 *   button with focus back on the button, closes when Tab or Shift-Tab
 *   leaves it, with focus where it went, and on a press outside, and is
 *   closed after a navigation;
 * - a query typed in the bar landing on `/search/?q=…`, with the page's own
 *   hint for a query too short;
 * - on the search page, no second form: the control focuses the page's
 *   field, and the page has one `search` landmark;
 * - no layout shift on load or on opening, nothing moved under the bar, the
 *   header's height unchanged, the target at least 44 px square, no
 *   sideways scroll and the bar inside the viewport, at 320 and 1280 px;
 * - the bar's motion, off under reduced motion;
 * - axe in each state, closed, open and without JavaScript, in both schemes.
 *
 * The header's one-row height with the control in it is `brand.spec.ts`'s.
 */

const cms = mockCms();

const SCHEMES = ["light", "dark"] as const;
const WIDTHS = [320, 1280] as const;

test.beforeEach(async ({ request }) => {
  await cms.reset();
  await clearAppCache(request);
});

/** The header's control once hydration has made it a button: the first button named Search, before the bar's own. */
function toggle(page: Page): Locator {
  return page.getByRole("banner").getByRole("button", { name: "Search", exact: true }).first();
}

/** The bar's submit button, also named Search, as on the search page. */
function submit(page: Page): Locator {
  return bar(page).getByRole("button", { name: "Search", exact: true });
}

function barField(page: Page): Locator {
  return page.getByRole("banner").getByRole("searchbox", { name: "Search resources and pages" });
}

function bar(page: Page): Locator {
  return page.locator("#rh-header-search-panel");
}

async function expectClosed(page: Page): Promise<void> {
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(bar(page)).toBeHidden();
}

async function expectOpen(page: Page): Promise<void> {
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(bar(page)).toBeVisible();
  await expect(barField(page)).toBeFocused();
}

/** Starts recording layout shifts, including those within 500 ms of input, which CLS leaves out. */
async function recordShifts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __shifts: number[] };
    store.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.__shifts.push((entry as unknown as { value: number }).value);
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function shifts(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __shifts: number[] }).__shifts);
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("is a plain link named Search that reaches the search page", async ({ page }) => {
    await page.goto("/resources/");
    const link = page.getByRole("banner").getByRole("link", { name: "Search", exact: true });
    await expect(link).toHaveAttribute("href", "/search/");
    await expect(page.getByRole("banner").getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("search")).toHaveCount(0);
    await link.click();
    await expect(page).toHaveURL(/\/search\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  });

  test("links to the page's own field on the search page, keeping the query", async ({ page }) => {
    await page.goto("/search/?q=team");
    const link = page.getByRole("banner").getByRole("link", { name: "Search", exact: true });
    await expect(link).toHaveAttribute("href", "#rh-search-q");
    await expect(page.getByRole("search")).toHaveCount(1);
    await link.click();
    await expect(page).toHaveURL(/\/search\/\?q=team#rh-search-q$/);
    await expect(page.getByRole("searchbox")).toHaveValue("team");
  });

});

// axe runs as a script, so the server's link is scanned with the app's own
// bundles blocked instead: React never runs, and the page is the HTML a
// reader without JavaScript gets.
test.describe("before any bundle runs", () => {
  for (const colorScheme of SCHEMES) {
    test(`has no WCAG A or AA violation in the ${colorScheme} scheme`, async ({ page }) => {
      await page.route("**/_next/static/**/*.js", (route) => route.abort());
      await page.emulateMedia({ colorScheme });
      await page.goto("/resources/");
      await expect(page.getByRole("banner").getByRole("link", { name: "Search", exact: true })).toHaveAttribute("href", "/search/");
      expect(await wcagViolations(page)).toEqual([]);
    });
  }
});

test.describe("with JavaScript", () => {
  test("is a disclosure button that controls the bar, closed at first", async ({ page }) => {
    await page.goto("/resources/");
    await expectClosed(page);
    await expect(toggle(page)).toHaveAttribute("aria-controls", "rh-header-search-panel");
    await expect(page.getByRole("banner").getByRole("link", { name: "Search" })).toHaveCount(0);
    await expect(page.getByRole("search")).toHaveCount(0);
  });

  test("opens and closes by mouse, moving focus to the bar's field", async ({ page }) => {
    await page.goto("/resources/");
    await toggle(page).click();
    await expectOpen(page);
    await expect(page.getByRole("search")).toHaveCount(1);
    await toggle(page).click();
    await expectClosed(page);
    await expect(toggle(page)).toBeFocused();
    await expect(page.getByRole("search")).toHaveCount(0);
  });

  test("is the third Tab stop and opens with Enter and with Space", async ({ page }) => {
    await page.goto("/resources/");
    await expectClosed(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Resource Hub", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expectOpen(page);
    await page.keyboard.press("Shift+Tab");
    await expect(toggle(page)).toBeFocused();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expectClosed(page);
    await page.keyboard.press("Space");
    await expectOpen(page);
  });

  test("closes on Escape from the field and from the button, with focus back on the button", async ({ page }) => {
    await page.goto("/resources/");
    await toggle(page).click();
    await expectOpen(page);
    await barField(page).fill("acc");
    await page.keyboard.press("Escape");
    await expectClosed(page);
    await expect(toggle(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expectOpen(page);
    // The words typed are kept while the page lasts.
    await expect(barField(page)).toHaveValue("acc");
    await page.keyboard.press("Shift+Tab");
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expectClosed(page);
    await expect(toggle(page)).toBeFocused();
  });

  test("never traps focus: Tab or Shift-Tab out of it closes it, with focus where it went", async ({ page }) => {
    await page.goto("/resources/");
    await toggle(page).click();
    await expectOpen(page);
    await page.keyboard.press("Tab");
    await expect(submit(page)).toBeFocused();
    await page.keyboard.press("Tab");
    // Past the bar's submit button: the page's first link, which the bar no longer covers.
    await expectClosed(page);
    await expect(page.getByRole("link", { name: "All types", exact: true })).toBeFocused();

    await toggle(page).click();
    await expectOpen(page);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expectClosed(page);
    await expect(page.getByRole("link", { name: "Resource Hub", exact: true })).toBeFocused();
  });

  test("closes on a press outside it, and stays open on a press inside the bar", async ({ page }) => {
    await page.goto("/resources/");
    await toggle(page).click();
    await expectOpen(page);
    await page.getByText("Search resources and pages").click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await page.mouse.click(5, 400);
    await expectClosed(page);
  });

  test("is closed after a client navigation, which keeps the header", async ({ page }) => {
    await page.goto("/resources/");
    await page.getByRole("navigation", { name: "Filter resources" }).getByRole("link", { name: "Webinar", exact: true }).click();
    await expect(page).toHaveURL(/\/resources\/webinar\/$/);
    await toggle(page).click();
    await expectOpen(page);
    // Back is a client navigation with no press on the page, so only the path can close the bar.
    await page.goBack();
    await expect(page).toHaveURL(/\/resources\/$/);
    await expectClosed(page);
  });

  test("submits a query to the search page, as the page's own form does", async ({ page }) => {
    await page.goto("/resources/");
    await toggle(page).click();
    await barField(page).fill("team");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\/\?q=team$/);
    await expect(page.getByText(/^\d+ results? for “team”/)).toBeVisible();

    await page.goto("/welcome/");
    await toggle(page).click();
    await barField(page).fill("a");
    await submit(page).click();
    await expect(page).toHaveURL(/\/search\/\?q=a$/);
    // The page's own hint, tied to its field: the bar needs no second validator.
    await expect(page.getByText("Enter at least 2 characters to search.")).toBeVisible();
  });

  test("on the search page, focuses the page's own field instead of opening a second form", async ({ page }) => {
    await page.goto("/search/?q=team");
    const control = page.getByRole("banner").getByRole("link", { name: "Search", exact: true });
    await expect(control).toHaveAttribute("href", "#rh-search-q");
    await expect(page.getByRole("banner").getByRole("button")).toHaveCount(0);
    await control.click();
    await expect(page.getByRole("main").getByRole("searchbox")).toBeFocused();
    await expect(page.getByRole("search")).toHaveCount(1);
    // Focused by script, so the URL keeps the query and gains no fragment.
    await expect(page).toHaveURL(/\/search\/\?q=team$/);
  });

  test("moves the bar in under motion and shows it at once under reduced motion", async ({ page }) => {
    await page.goto("/resources/");
    await toggle(page).click();
    await expectOpen(page);
    expect(await bar(page).evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0.15s, 0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await bar(page).evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  });

  for (const width of WIDTHS) {
    test(`moves nothing on load or on opening, and fits, at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/resources/");
      await page.evaluate(() => document.fonts.ready);
      await expectClosed(page);
      await recordShifts(page);
      const header = page.locator("header.rh-header");
      const heading = page.getByRole("heading", { level: 1 });
      const before = { header: await header.boundingBox(), heading: await heading.boundingBox() };

      const target = await toggle(page).boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
      // At the end of the row, inside the gutter.
      expect(target!.x + target!.width).toBeLessThanOrEqual(width - 16 + 0.5);

      await toggle(page).click();
      await expectOpen(page);
      await page.waitForTimeout(300);
      expect(await header.boundingBox()).toEqual(before.header);
      expect(await heading.boundingBox()).toEqual(before.heading);
      expect(await shifts(page)).toEqual([]);

      const panel = await bar(page).boundingBox();
      expect(panel!.x).toBe(0);
      expect(panel!.width).toBeLessThanOrEqual(width);
      expect(panel!.y).toBeGreaterThanOrEqual(before.header!.y + before.header!.height);
      const field = await barField(page).boundingBox();
      expect(field!.x).toBeGreaterThanOrEqual(16 - 0.5);
      expect(field!.x + field!.width).toBeLessThanOrEqual(width - 16 + 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  for (const colorScheme of SCHEMES) {
    for (const width of WIDTHS) {
      test(`has no WCAG A or AA violation closed and open, in the ${colorScheme} scheme at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page.goto("/resources/");
        await expectClosed(page);
        expect(await wcagViolations(page)).toEqual([]);
        await toggle(page).click();
        await expectOpen(page);
        expect(await wcagViolations(page)).toEqual([]);
        // Hovered and focused: the ring and the border still read on the header.
        await toggle(page).hover();
        await toggle(page).focus();
        expect(await wcagViolations(page)).toEqual([]);
      });
    }
  }
});
