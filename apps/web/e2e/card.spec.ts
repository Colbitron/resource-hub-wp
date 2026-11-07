import { expect, test, type Page } from "@playwright/test";

/**
 * The resource row (`components/ResourceCard.tsx`, `packages/ui/card.css`)
 * on the fixture page at /fixtures/cards/, which renders four rows with
 * fixed props inside the page shell: the shell's landmarks, the skip link,
 * one focusable element per row (its title link) and the link's hit area
 * over the whole row, the type mark's colour by accent and the neutral
 * fallback, the row's two columns where they fit and one where they do not,
 * and no horizontal scroll at 360 px. The route exists only under
 * RH_FIXTURES=1, which playwright.config.ts sets.
 */
const FIXTURE_PATH = "/fixtures/cards/";

/** Anything the keyboard can land on by Tab. */
const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

async function openFixture(page: Page) {
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

test("the row's link covers the whole row", async ({ page }) => {
  await openFixture(page);
  const card = page.locator(".rh-card").first();
  const box = await card.boundingBox();
  if (!box) throw new Error("card has no box");
  // Click the bottom-right corner of the row, far from the title text.
  await page.mouse.click(box.x + box.width - 8, box.y + box.height - 8);
  await expect(page).toHaveURL(/\/resources\/guide\/planning-a-content-model\/$/);
});

/** The colour an element's `::before` is painted, and the colour a token resolves to on this page. */
async function markColour(page: Page, index: number): Promise<{ dot: string; attribute: string | null }> {
  return page.locator(".rh-card__type").nth(index).evaluate((node) => ({
    dot: getComputedStyle(node, "::before").backgroundColor,
    attribute: node.getAttribute("data-accent"),
  }));
}

async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

test("the type mark is a dot in the accent's colour, and the ink for a type the table does not know", async ({ page }) => {
  await openFixture(page);
  // The fixture's rows: Guide (neutral), Webinar (coral), Report (neutral), Article (mint).
  expect(await markColour(page, 1)).toEqual({ dot: await tokenColour(page, "--rh-mark-coral"), attribute: "coral" });
  expect(await markColour(page, 3)).toEqual({ dot: await tokenColour(page, "--rh-mark-mint"), attribute: "mint" });
  const ink = await tokenColour(page, "--rh-color-text");
  expect(await markColour(page, 0)).toEqual({ dot: ink, attribute: "neutral" });
  expect(await markColour(page, 2)).toEqual({ dot: ink, attribute: "neutral" });
  // The dot is a filled circle beside the printed name, never text.
  const dot = await page.locator(".rh-card__type").first().evaluate((node) => {
    const style = getComputedStyle(node, "::before");
    return { shape: style.borderRadius, width: style.width, content: style.content };
  });
  expect(dot.shape).toBe("50%");
  expect(dot.content).toBe('""');
  expect(Number.parseFloat(dot.width)).toBeGreaterThan(0);
});

test.describe("the row is two columns where they fit and one where they do not", () => {
  test("at 1280px the meta line is a column beside the body", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openFixture(page);
    const row = page.locator(".rh-card").first();
    const meta = await row.locator(".rh-card__meta").boundingBox();
    const body = await row.locator(".rh-card__body").boundingBox();
    if (!meta || !body) throw new Error("the row has no boxes");
    expect(body.x).toBeGreaterThan(meta.x + meta.width);
    expect(Math.abs(body.y - meta.y)).toBeLessThan(8);
  });

  test("at 360px the body wraps under the meta line, which spans the width", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openFixture(page);
    const row = page.locator(".rh-card").first();
    const meta = await row.locator(".rh-card__meta").boundingBox();
    const body = await row.locator(".rh-card__body").boundingBox();
    const rowBox = await row.boundingBox();
    if (!meta || !body || !rowBox) throw new Error("the row has no boxes");
    expect(body.y).toBeGreaterThan(meta.y + meta.height - 1);
    expect(meta.width).toBeCloseTo(rowBox.width, 0);
    // The type and the date share the line.
    const type = await row.locator(".rh-card__type").boundingBox();
    const time = await row.locator("time").boundingBox();
    if (!type || !time) throw new Error("the meta line has no boxes");
    expect(Math.abs(type.y - time.y)).toBeLessThan(8);
  });
});

test("nothing scrolls horizontally at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openFixture(page);
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  // No row, title or meta line is wider than the viewport either.
  const overflowing = await page
    .locator(".rh-card, .rh-card__title, .rh-card__meta")
    .evaluateAll((nodes) =>
      nodes.filter((node) => node.getBoundingClientRect().right > document.documentElement.clientWidth).length,
    );
  expect(overflowing).toBe(0);
});

test("the row carries no image", async ({ page }) => {
  await openFixture(page);
  await expect(page.locator(".rh-card img")).toHaveCount(0);
});
