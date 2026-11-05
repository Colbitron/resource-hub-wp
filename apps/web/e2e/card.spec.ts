import { expect, test, type Page } from "@playwright/test";

// The fixture page renders a few <ResourceCard>s inside the page shell. It is
// a route only under RH_FIXTURES=1, which playwright.config.ts sets.
const FIXTURE_PATH = "/fixtures/cards/";

/** Anything the keyboard can land on by Tab. */
const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

async function openFixture(page: Page) {
  // No CMS is behind /media/ here, so the image optimizer would fail on every
  // card image. Abort those requests: the cards must hold their shape without.
  await page.route("**/_next/image**", (route) => route.abort());
  await page.goto(FIXTURE_PATH);
}

test("the shell has a banner, a main and a contentinfo landmark", async ({ page }) => {
  await openFixture(page);
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  await expect(page.getByRole("banner").getByRole("link", { name: "Resource Hub" })).toHaveAttribute(
    "href",
    "/resources/",
  );
});

test("the skip link is the first tab stop and moves focus to main", async ({ page }) => {
  await openFixture(page);
  const skip = page.getByRole("link", { name: "Skip to content" });

  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();

  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(new URL(page.url()).hash).toBe("#main");

  // The next Tab continues into the content, not back to the header.
  await page.keyboard.press("Tab");
  await expect(page.locator(".rh-card__link").first()).toBeFocused();
});

test("each card has exactly one focusable element, its title link", async ({ page }) => {
  await openFixture(page);
  const cards = page.locator(".rh-card");
  await expect(cards).toHaveCount(4);

  const focusablePerCard = await cards.evaluateAll((nodes, selector) =>
    nodes.map((card) => {
      const focusable = card.querySelectorAll(selector);
      return {
        count: focusable.length,
        isTitleLink: focusable[0]?.classList.contains("rh-card__link") ?? false,
      };
    }),
    FOCUSABLE,
  );
  for (const card of focusablePerCard) {
    expect(card).toEqual({ count: 1, isTitleLink: true });
  }

  // Tabbing through the grid lands on each card's link in turn and nothing else.
  await page.getByRole("main").focus();
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Tab");
    await expect(cards.nth(i).locator(".rh-card__link")).toBeFocused();
  }
});

test("the card's link covers the whole card", async ({ page }) => {
  await openFixture(page);
  const card = page.locator(".rh-card").first();
  const box = await card.boundingBox();
  if (!box) throw new Error("card has no box");
  // Click the bottom-right corner of the card, far from the title text.
  await page.mouse.click(box.x + box.width - 8, box.y + box.height - 8);
  await expect(page).toHaveURL(/\/resources\/guide\/planning-a-content-model\/$/);
});

test("nothing scrolls horizontally at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openFixture(page);
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  // No card, title or media box is wider than the viewport either.
  const overflowing = await page
    .locator(".rh-card, .rh-card__title, .rh-card__media")
    .evaluateAll((nodes) =>
      nodes.filter((node) => node.getBoundingClientRect().right > document.documentElement.clientWidth).length,
    );
  expect(overflowing).toBe(0);
});

test.describe("the media box keeps a 16:9 aspect ratio", () => {
  for (const width of [360, 1280]) {
    test(`at ${width}px, whatever the image's own shape`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openFixture(page);
      const boxes = page.locator(".rh-card__media");
      // Three cards carry images with ratios 3:2, 8:3 and 1:1; the fourth has none.
      await expect(boxes).toHaveCount(3);
      for (const box of await boxes.all()) {
        await expect(box).toHaveCSS("aspect-ratio", "16 / 9");
        const rect = await box.boundingBox();
        if (!rect) throw new Error("media box has no box");
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.width / rect.height).toBeCloseTo(16 / 9, 1);
      }
    });
  }
});
