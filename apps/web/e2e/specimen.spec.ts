import { expect, test } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { wcagViolations } from "./axe.mts";
import { mockCms } from "./mock-cms/client.mts";

/**
 * The design specimen (`app/fixtures/specimen/`), the reference page for the
 * design work and the screenshot target (`specimen.screenshot.ts`): that
 * every token it shows has a value on the page, that it renders each
 * component and state (the theme control's three states among them, beside
 * the footer's live one), that its copy of the listing's empty state matches
 * the real route's, that it holds at phone width, and that it passes the
 * same axe scan as the sampled pages (`a11y.spec.ts`), so the reference is
 * itself accessible. Which tokens it shows is checked against `tokens.css`
 * by the unit test `test/specimen-tokens.test.ts`. A route only under
 * RH_FIXTURES=1, which playwright.config.ts sets.
 */

const SPECIMEN_PATH = "/fixtures/specimen/";

test("every token it shows has a value on the page", async ({ page }) => {
  await page.goto(SPECIMEN_PATH);
  const unset = await page.locator("[data-token]").evaluateAll((nodes) => {
    const root = getComputedStyle(document.documentElement);
    return nodes
      .map((node) => node.getAttribute("data-token") ?? "")
      .filter((token) => root.getPropertyValue(token).trim() === "");
  });
  expect(unset).toEqual([]);
});

test("shows the shell, the filters, the lead, a row of each type and a neutral one, pagination and prose", async ({ page }) => {
  await page.goto(SPECIMEN_PATH);
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  const filters = page.getByRole("navigation", { name: "Filter resources" });
  await expect(filters).toBeVisible();
  await expect(filters.locator("[aria-current]")).toHaveText(["Webinar", "Performance"]);
  // The lead with its image, then the one without, in the states section.
  await expect(page.locator(".rh-lead")).toHaveCount(2);
  await expect(page.locator(".rh-lead__media img")).toHaveCount(1);
  await expect(page.locator(".rh-lead .rh-card__type")).toHaveText(["Article", "Webinar"]);
  // The rows section alone: the resource sample's related block holds rows of its own (checked below).
  const rows = page.locator("section[aria-labelledby='specimen-cards'] .rh-card .rh-card__type");
  await expect(rows).toHaveText(["Article", "Case study", "Ebook", "Podcast", "Webinar", "Guide"]);
  await expect(rows.last()).toHaveAttribute("data-accent", "neutral");
  const prose = page.locator("section[aria-labelledby='specimen-prose'] .rh-prose");
  for (const selector of ["h2", "h3", "ul", "ol", "blockquote", "table", "a"]) {
    await expect(prose.locator(selector).first(), selector).toBeVisible();
  }
});

test("shows the theme control with each option checked, and the footer's live one", async ({ page }) => {
  await page.goto(SPECIMEN_PATH);
  const states = page.locator("section[aria-labelledby='specimen-states']").getByRole("group", { name: "Theme" });
  await expect(states).toHaveCount(3);
  for (const [index, name] of ["System theme", "Light theme", "Dark theme"].entries()) {
    const copy = states.nth(index);
    await expect(copy.getByRole("radio")).toHaveCount(3);
    await expect(copy.getByRole("radio", { name, exact: true })).toBeChecked();
    await expect(copy.getByRole("radio", { checked: true })).toHaveCount(1);
  }
  // The three copies are three groups: a copy's radios share a name with no other copy's.
  const names = await states.locator("input").evaluateAll((inputs) => new Set(inputs.map((input) => (input as HTMLInputElement).name)).size);
  expect(names).toBe(3);
  // The footer's own control is live and separate: System, nothing stored.
  // The header has none: it holds the site's name alone.
  await expect(page.getByRole("banner").getByRole("group")).toHaveCount(0);
  const live = page.getByRole("contentinfo").getByRole("group", { name: "Theme" });
  await expect(live).toBeVisible();
  await expect(live.getByRole("radio", { name: "System theme", exact: true })).toBeChecked();

  // The copies are inert: a click or an arrow key on one leaves its state, the
  // page's theme and storage as they were.
  const systemCopy = states.nth(0);
  await systemCopy.getByRole("radio", { name: "Dark theme", exact: true }).click();
  await expect(systemCopy.getByRole("radio", { name: "System theme", exact: true })).toBeChecked();
  await expect(systemCopy.getByRole("radio", { name: "Dark theme", exact: true })).not.toBeChecked();
  await states.nth(1).getByRole("radio", { name: "Light theme", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(states.nth(1).getByRole("radio", { name: "Light theme", exact: true })).toBeChecked();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  expect(await page.evaluate(() => localStorage.getItem("rh-theme"))).toBeNull();
  await expect(live.getByRole("radio", { name: "System theme", exact: true })).toBeChecked();
});

test("shows pagination in the middle and at both ends", async ({ page }) => {
  await page.goto(SPECIMEN_PATH);
  const navs = page.getByRole("navigation", { name: "Pagination" });
  await expect(navs).toHaveCount(3);
  await expect(navs.nth(0).locator('[aria-current="page"]')).toHaveText("4");
  await expect(navs.nth(1).getByRole("link", { name: "Previous" })).toHaveCount(0);
  await expect(navs.nth(1).getByRole("link", { name: "Next" })).toBeVisible();
  await expect(navs.nth(2).getByRole("link", { name: "Previous" })).toBeVisible();
  await expect(navs.nth(2).getByRole("link", { name: "Next" })).toHaveCount(0);
});

test("shows a resource, a CMS page, the welcome page and the 404 page", async ({ page }) => {
  await page.goto(SPECIMEN_PATH);
  const resource = page.locator(".rh-resource");
  await expect(resource.getByRole("heading", { level: 1 })).toHaveText("Taxonomies versus meta");
  const meta = resource.locator(".rh-resource__meta");
  await expect(meta.getByRole("link", { name: "Article" })).toHaveAttribute("href", "/resources/article/");
  await expect(meta.locator("time")).toBeVisible();
  await expect(meta.getByRole("list", { name: "Topics" }).getByRole("link")).toHaveText(["Content modelling", "Performance"]);
  await expect(resource.locator(".rh-resource__media img")).toBeVisible();
  await expect(resource.locator(".rh-resource__summary")).toBeVisible();
  // The type mark is the row's, outside the link; the topics are the row's labels with links inside.
  await expect(meta.locator(".rh-card__type")).toHaveAttribute("data-accent", "mint");
  await expect(meta.locator(".rh-card__topics .rh-card__topic")).toHaveCount(2);
  // The article's insets and figures, one of each: the quote, the table in its region, code, and a figure with its upload and caption.
  const body = resource.locator(".rh-resource__body.rh-prose");
  await expect(body.locator("blockquote cite")).toHaveText("A rule of thumb from the plugin's first review");
  await expect(body.getByRole("region", { name: "Table", exact: true }).locator("table")).toHaveCount(1);
  await expect(body.locator("pre code")).toBeVisible();
  expect(decodeURIComponent((await body.locator("figure.wp-block-image img").getAttribute("src")) ?? "")).toContain("/media/2026/11/content-model.png");
  await expect(body.locator("figure.wp-block-image figcaption")).toBeVisible();
  // The related-resources block's fallback: the CMS's heading and its rows of card.css, kept by the pass inside the
  // wrapper it marks `rh-related`, with the rows' links made root-relative and the rows' marks in the neutral ink.
  const related = body.locator(".rh-related");
  await expect(related.getByRole("heading", { level: 2, name: "More on content modelling" })).toBeVisible();
  await expect(related.locator("ul.rh-card-grid[role=list] > li > article.rh-card")).toHaveCount(2);
  await expect(related.locator("h3.rh-card__title")).toHaveCount(2);
  await expect(related.locator(".rh-card").first().getByRole("list", { name: "Topics" })).toHaveText("Content modelling");
  await expect(related.locator(".rh-card__type").first()).not.toHaveAttribute("data-accent", /./);
  await expect(body.getByRole("link", { name: "One content model, five channels" })).toHaveAttribute(
    "href",
    "/resources/case-study/one-content-model-five-channels/",
  );
  await expect(resource.locator(".rh-resource__source a")).toBeVisible();

  const cmsPage = page.locator(".rh-page:not(.rh-welcome)");
  await expect(cmsPage.getByRole("heading", { level: 1 })).toHaveText("Welcome to the hub");
  await expect(cmsPage.locator(".rh-page__body.rh-prose a").first()).toHaveAttribute("href", "/resources/");
  await expect(page.locator(".rh-welcome").getByRole("heading", { level: 1 })).toHaveText("Resource Hub");
  await expect(page.locator(".rh-not-found").getByRole("heading", { level: 1 })).toHaveText("Page not found");
  expect(await page.content()).not.toContain("127.0.0.1:");
});

test.describe("the empty listing state", () => {
  const cms = mockCms();

  test.beforeEach(async ({ request }) => {
    await cms.reset();
    // Listings outlive a reset in the app's cache (e2e/README.md).
    await clearAppCache(request);
  });

  test("is the same markup as on a listing with nothing in it", async ({ page }) => {
    const response = await page.goto("/resources/podcast/topic/accessibility/");
    expect(response?.status()).toBe(200);
    const real = await page.locator(".rh-listing__empty").evaluate((node) => node.outerHTML);
    await page.goto(SPECIMEN_PATH);
    const copy = await page.locator(".rh-listing__empty").evaluate((node) => node.outerHTML);
    expect(copy).toBe(real);
  });
});

test("the lead's image loads", async ({ page }) => {
  await page.goto(SPECIMEN_PATH);
  const images = page.locator(".rh-lead__media img");
  await expect(images).toHaveCount(1);
  await expect
    .poll(() => images.evaluateAll((nodes) => nodes.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)))
    .toBe(true);
});

test("nothing scrolls horizontally at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(SPECIMEN_PATH);
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`has no WCAG A or AA violation in the ${colorScheme} scheme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto(SPECIMEN_PATH);
    expect(await wcagViolations(page)).toEqual([]);
  });
}
