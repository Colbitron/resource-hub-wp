import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { mockCms } from "./mock-cms/client.mts";
import { appSiteOrigin } from "./mock-cms/config.mts";

/**
 * The brand layer (`packages/ui/DESIGN.md`, "Brand"): the header's lockup
 * as the one home link, named "Resource Hub" with the mark hidden from
 * assistive technology, in the Tab order after the skip link and before the
 * theme control; the footer's publisher link; the icon files and the default
 * share image, each answering with the right content type and size; a
 * resource with a featured image keeping that image as its share image
 * while one without gets the default; no request for the removed
 * `favicon.ico` and no console error on a page load; and no horizontal
 * scroll at 320 px with the lockup in the header. The axe scan of every
 * sampled page in both schemes is `a11y.spec.ts`, which covers the shell.
 */

const cms = mockCms();

/** A resource with a trusted featured image (the long-form article) and one with none. */
const WITH_IMAGE = "/resources/article/taxonomies-versus-meta/";
const WITHOUT_IMAGE = "/resources/article/alt-text-at-scale/";

test.beforeEach(async ({ request }) => {
  await cms.reset();
  // Listings outlive a reset in the app's cache (e2e/README.md).
  await clearAppCache(request);
});

/** The width and height a PNG declares in its IHDR chunk, and its colour type (2 is RGB, with no alpha channel). */
function pngHeader(bytes: Buffer): { width: number; height: number; colourType: number } {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

/** The `content` of one `<meta>` by its `property` or `name`, or `null`. */
async function meta(page: Page, selector: string): Promise<string | null> {
  const nodes = page.locator(`meta[${selector}]`);
  return (await nodes.count()) === 0 ? null : nodes.first().getAttribute("content");
}

test.describe("the header's lockup", () => {
  test("is one home link named Resource Hub, with the mark hidden from assistive technology", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByRole("banner");
    const home = banner.getByRole("link", { name: "Resource Hub", exact: true });
    await expect(home).toHaveCount(1);
    await expect(home).toHaveAttribute("href", "/resources/");
    await expect(home).toHaveAccessibleName("Resource Hub");
    // The mark is inside the link, decorative, and not an image to a screen reader.
    const mark = home.locator("svg");
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveAttribute("aria-hidden", "true");
    await expect(mark).toHaveAttribute("focusable", "false");
    await expect(banner.getByRole("img")).toHaveCount(0);
    // One home link in the header: the name is not linked twice.
    await expect(banner.getByRole("link")).toHaveCount(1);
  });

  for (const [path, first] of [
    ["/", "Browse the library"],
    ["/resources/", "All types"],
  ] as const) {
    test(`is the second Tab stop on ${path}: skip link, home link, theme control, then the page`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("banner").getByRole("radio", { name: "System theme", exact: true })).toBeChecked();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Resource Hub", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("radio", { name: "System theme", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: first, exact: true })).toBeFocused();
    });
  }
});

test("the footer names the publisher, with its one link, and says what the site is", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toHaveCount(1);
  const publisher = footer.getByRole("link", { name: "Colbination", exact: true });
  await expect(publisher).toHaveAttribute("href", "https://colbination.com/");
  await expect(footer.getByRole("link")).toHaveCount(1);
  await expect(footer).toContainText("Published by Colbination.");
  await expect(footer).toContainText("A headless WordPress demonstration: WordPress models the library, Next.js renders it.");
});

test.describe("the icons", () => {
  test("the SVG icon is the mark, served as the site's icon for any size", async ({ page, request }) => {
    await page.goto("/");
    const icon = page.locator('link[rel="icon"]');
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute("type", "image/svg+xml");
    await expect(icon).toHaveAttribute("sizes", "any");
    const href = (await icon.getAttribute("href")) as string;
    expect(href).toMatch(/^\/icon\.svg(\?|$)/);
    const response = await request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
    const served = await response.text();
    expect(served.replace(/\s+/g, " ")).toBe(readFileSync(join(__dirname, "../app/icon.svg"), "utf8").replace(/\s+/g, " "));
  });

  test("the apple touch icon is a 180 px PNG with no alpha channel", async ({ page, request }) => {
    await page.goto("/");
    const apple = page.locator('link[rel="apple-touch-icon"]');
    await expect(apple).toHaveCount(1);
    await expect(apple).toHaveAttribute("type", "image/png");
    await expect(apple).toHaveAttribute("sizes", "180x180");
    const response = await request.get((await apple.getAttribute("href")) as string);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^image\/png/);
    expect(pngHeader(await response.body())).toEqual({ width: 180, height: 180, colourType: 2 });
  });

  test("no favicon.ico is linked, and a request for it is a 404 that asks the CMS nothing", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('link[href*="favicon.ico"]')).toHaveCount(0);
    // The page route answers a segment with a dot from the path alone (ADR
    // 0052): no page lookup names it. The total is not compared, because the
    // open page prefetches the library link meanwhile.
    await cms.resetRequests();
    const response = await request.get("/favicon.ico", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(Object.keys((await cms.requests()).byPath).filter((path) => path.includes("favicon"))).toEqual([]);
  });
});

test.describe("the share image", () => {
  test("is the default, 1200 by 630, on the front page, a listing and a CMS page", async ({ page, request }) => {
    const site = appSiteOrigin();
    // The listing, which writes no `openGraph`, gets the file-based tag with
    // Next.js's cache-busting query; the front page and a CMS page write their
    // own and name the file's route (lib/share-image.ts). One image either way.
    let href: string | null = null;
    for (const path of ["/", "/resources/", "/welcome/"]) {
      await page.goto(path);
      const images = page.locator('meta[property="og:image"]');
      await expect(images, path).toHaveCount(1);
      const content = (await images.getAttribute("content")) as string;
      expect(content, path).toMatch(new RegExp(`^${site}/opengraph-image\\.png(\\?|$)`));
      href ??= content;
      expect(await meta(page, 'property="og:image:width"'), path).toBe("1200");
      expect(await meta(page, 'property="og:image:height"'), path).toBe("630");
      expect(await meta(page, 'property="og:image:type"'), path).toBe("image/png");
      expect(await meta(page, 'property="og:image:alt"'), path).toBe("Resource Hub, published by Colbination");
      // Next.js derives the Twitter card from the Open Graph fields; nothing is written for it.
      expect(await meta(page, 'name="twitter:card"'), path).toBe("summary_large_image");
      expect(await meta(page, 'name="twitter:image"'), path).toBe(content);
    }
    const response = await request.get(href as string);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^image\/png/);
    expect(pngHeader(await response.body())).toEqual({ width: 1200, height: 630, colourType: 2 });
  });

  test("a resource with a featured image keeps that image; one without gets the default", async ({ page }) => {
    const site = appSiteOrigin();
    await page.goto(WITH_IMAGE);
    const own = page.locator('meta[property="og:image"]');
    await expect(own).toHaveCount(1);
    expect(await own.getAttribute("content")).toMatch(new RegExp(`^${site}/media/`));
    expect(await meta(page, 'name="twitter:image"')).toBe(await own.getAttribute("content"));

    await page.goto(WITHOUT_IMAGE);
    const fallback = page.locator('meta[property="og:image"]');
    await expect(fallback).toHaveCount(1);
    expect(await fallback.getAttribute("content")).toMatch(new RegExp(`^${site}/opengraph-image\\.png(\\?|$)`));
    expect(await meta(page, 'property="og:image:width"')).toBe("1200");
  });
});

for (const path of ["/", "/resources/", WITH_IMAGE]) {
  test(`loading ${path} logs no console error and 404s nothing`, async ({ page }) => {
    const errors: string[] = [];
    const notFound: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() === 404) notFound.push(response.url());
    });
    await page.goto(path);
    await expect(page.getByRole("banner").getByRole("radio", { name: "System theme", exact: true })).toBeChecked();
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
    expect(notFound).toEqual([]);
  });
}

for (const path of ["/", "/resources/", WITH_IMAGE]) {
  test(`nothing scrolls horizontally at 320 px on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(path);
    await expect(page.getByRole("banner").getByRole("radio", { name: "System theme", exact: true })).toBeChecked();
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    // The lockup stays on one line, and the control keeps its words.
    const name = page.getByRole("link", { name: "Resource Hub", exact: true });
    const box = await name.boundingBox();
    expect(box?.height ?? 0).toBeLessThan(40);
    const label = page.getByRole("banner").locator(".rh-theme__label").first();
    await expect(label).toBeVisible();
    await expect(label).toContainText("System");
  });
}
