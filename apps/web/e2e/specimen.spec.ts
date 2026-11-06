import { expect, test } from "@playwright/test";

import { SPECIMEN_TOKENS } from "../app/fixtures/specimen/tokens.ts";
import { wcagViolations } from "./axe.mts";

/**
 * The design specimen (`app/fixtures/specimen/`), the reference page for the
 * design work and the screenshot target (`specimen.screenshot.ts`): that it
 * renders an entry for every shared token and each component, that it holds
 * at phone width, and that it passes the same axe scan as the sampled pages
 * (`a11y.spec.ts`), so the reference is itself accessible. A route only
 * under RH_FIXTURES=1, which playwright.config.ts sets.
 */

const SPECIMEN_PATH = "/fixtures/specimen/";

test("shows an entry for every shared token", async ({ page }) => {
  await page.goto(SPECIMEN_PATH);
  const rendered = await page.locator("[data-token]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-token")));
  expect(rendered).toEqual([...SPECIMEN_TOKENS]);
});

test("shows the shell, the filters, a card of each type, pagination and prose", async ({ page }) => {
  await page.goto(SPECIMEN_PATH);
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Filter resources" })).toBeVisible();
  await expect(page.locator(".rh-card__type")).toHaveText(["Article", "Case study", "Ebook", "Podcast", "Webinar"]);
  await expect(page.getByRole("navigation", { name: "Pagination" })).toBeVisible();
  const prose = page.locator(".rh-prose");
  for (const selector of ["h2", "h3", "ul", "ol", "blockquote", "table", "a"]) {
    await expect(prose.locator(selector).first(), selector).toBeVisible();
  }
});

test("every card image loads", async ({ page }) => {
  await page.goto(SPECIMEN_PATH);
  const images = page.locator(".rh-card__media img");
  await expect(images).toHaveCount(4);
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
