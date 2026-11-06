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
 * theme control; the header's height at phone widths; the lockup under
 * forced colours; the footer's publisher link; the icon files (the SVG,
 * the 32 px PNG, `favicon.ico` and the apple touch icon) and the default
 * share image, each answering with the right content type and size, the
 * share image at one content-hashed URL per route; a resource with a
 * featured image keeping that image as its share image while one without
 * gets the default; no console error or 404 on a page load; and no
 * horizontal scroll at 320 px with the lockup in the header. The axe scan
 * of every sampled page in both schemes is `a11y.spec.ts`, which covers the
 * shell. That the committed PNGs are what the mark, the tokens and Figtree
 * draw now is the brand-image check in the screenshot run
 * (`scripts/render-brand-images.mts --check`).
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

/** The width and height a PNG declares in its IHDR chunk, and its colour type (2 is RGB, with no alpha channel; 6 is RGBA). */
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

  // Measured on 2026-11-06 on every page at 320, 360 and 412 px with the
  // theme control hydrated, where it wraps under the lockup: 110.5 px (75 px
  // at 1280, on one row). The half pixel is the margin for rounding; any
  // real growth (a step more padding, a taller lockup) is several pixels and
  // fails, because every pixel here pushes the listing's first image, the
  // LCP element at these widths, further down.
  for (const width of [360, 412]) {
    test(`keeps the header at most 111 px tall at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ["/", "/resources/"]) {
        await page.goto(path);
        await expect(page.getByRole("banner").getByRole("radio", { name: "System theme", exact: true })).toBeChecked();
        const header = await page.getByRole("banner").boundingBox();
        expect(header?.height ?? Infinity, path).toBeLessThanOrEqual(111);
      }
    });
  }

  test("stays visible and keeps its name under forced colours, the mark in its own colours", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
    const home = page.getByRole("banner").getByRole("link", { name: "Resource Hub", exact: true });
    await expect(home).toBeVisible();
    await expect(home).toHaveAccessibleName("Resource Hub");
    const mark = home.locator("svg");
    await expect(mark).toBeVisible();
    expect((await mark.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(24);
    // The wordmark takes the system's link colour, as every link does.
    // Chromium's own stylesheet gives an SVG `forced-color-adjust:
    // preserve-parent-color`, which forces only a fill or stroke inherited
    // as `currentColor`; the mark's colours are written on each shape, so
    // they survive: the shadow ink, the coral square and the ink "C", the
    // logo as it is everywhere else (measured in Chromium 1.64.1's build on
    // 2026-11-06).
    const shapes = await mark.evaluate((svg) =>
      [...svg.querySelectorAll("rect, path")].map((shape) => {
        const style = getComputedStyle(shape);
        return { fill: style.fill, stroke: style.stroke };
      }),
    );
    expect(shapes).toEqual([
      { fill: "rgb(27, 20, 54)", stroke: "none" },
      { fill: "rgb(255, 90, 79)", stroke: "rgb(27, 20, 54)" },
      { fill: "none", stroke: "rgb(27, 20, 54)" },
    ]);
  });
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
    const icon = page.locator('link[rel="icon"][type="image/svg+xml"]');
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute("sizes", "any");
    const href = (await icon.getAttribute("href")) as string;
    expect(href).toMatch(/^\/icon\.svg(\?|$)/);
    const response = await request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
    const served = await response.text();
    expect(served.replace(/\s+/g, " ")).toBe(readFileSync(join(__dirname, "../app/icon.svg"), "utf8").replace(/\s+/g, " "));
  });

  test("the 32 px PNG icon and favicon.ico are linked, for clients that read no SVG icon, with the SVG last", async ({ page, request }) => {
    await page.goto("/");
    // Three icons, the SVG last: a browser that reads SVG icons takes the
    // one sized `any`, and the two 32 px files are for the rest, which
    // includes Safari's tab and anyone asking for `/favicon.ico` unprompted.
    const icons = page.locator('link[rel="icon"]');
    await expect(icons).toHaveCount(3);
    expect(await icons.evaluateAll((links) => links.map((link) => link.getAttribute("type")))).toEqual([
      "image/x-icon",
      "image/png",
      "image/svg+xml",
    ]);

    const png = page.locator('link[rel="icon"][type="image/png"]');
    await expect(png).toHaveAttribute("sizes", "32x32");
    const pngHref = (await png.getAttribute("href")) as string;
    expect(pngHref).toMatch(/^\/icon\.png(\?|$)/);
    const pngResponse = await request.get(pngHref);
    expect(pngResponse.status()).toBe(200);
    expect(pngResponse.headers()["content-type"]).toMatch(/^image\/png/);
    const pngBytes = await pngResponse.body();
    // RGBA: the mark on a transparent background, as the SVG draws it.
    expect(pngHeader(pngBytes)).toEqual({ width: 32, height: 32, colourType: 6 });

    const ico = page.locator('link[rel="icon"][type="image/x-icon"]');
    await expect(ico).toHaveAttribute("sizes", "32x32");
    expect((await ico.getAttribute("href")) as string).toMatch(/^\/favicon\.ico(\?|$)/);
  });

  test("/favicon.ico answers itself, with no redirect and no CMS request: one 32 px PNG image, the PNG icon's", async ({ request }) => {
    await cms.resetRequests();
    const response = await request.get("/favicon.ico", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^image\/(x-icon|vnd\.microsoft\.icon)/);
    const ico = await response.body();
    // ICONDIR: reserved 0, type 1 (an icon), one image; its entry 32 by 32 at 32 bits.
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 1]);
    expect([ico[6], ico[7], ico.readUInt16LE(12)]).toEqual([32, 32, 32]);
    const size = ico.readUInt32LE(14);
    const offset = ico.readUInt32LE(18);
    const png = ico.subarray(offset, offset + size);
    expect(pngHeader(png)).toEqual({ width: 32, height: 32, colourType: 6 });
    expect(png.equals(readFileSync(join(__dirname, "../app/icon.png")))).toBe(true);
    expect(Object.keys((await cms.requests()).byPath).filter((path) => path.includes("favicon"))).toEqual([]);
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
});

test.describe("the share image", () => {
  /**
   * The routes that write their own `openGraph` name the PNG's static import,
   * `/_next/static/media/opengraph-image.<hash>.png` (lib/share-image.ts);
   * the routes that write none get the file-based tag,
   * `/opengraph-image.png?opengraph-image.<hash>.png`. Each is absolute from
   * `metadataBase` and changes with the file's bytes.
   */
  const HASHED_IMPORT = /\/_next\/static\/media\/opengraph-image\.([^./]+)\.png$/;
  const FILE_CONVENTION = /\/opengraph-image\.png\?opengraph-image\.([^./]+)\.png$/;

  test("is the default, 1200 by 630, at one content-hashed URL on the front page, a listing and a CMS page", async ({ page, request }) => {
    const site = appSiteOrigin();
    const hashes = new Set<string>();
    const bodies: Buffer[] = [];
    for (const [path, form] of [
      ["/", HASHED_IMPORT],
      ["/resources/", FILE_CONVENTION],
      ["/welcome/", HASHED_IMPORT],
    ] as const) {
      await page.goto(path);
      const images = page.locator('meta[property="og:image"]');
      await expect(images, path).toHaveCount(1);
      const content = (await images.getAttribute("content")) as string;
      expect(content.startsWith(`${site}/`), path).toBe(true);
      const match = form.exec(content);
      expect(match, `${path}: ${content}`).not.toBeNull();
      hashes.add((match as RegExpExecArray)[1]);
      expect(await meta(page, 'property="og:image:width"'), path).toBe("1200");
      expect(await meta(page, 'property="og:image:height"'), path).toBe("630");
      expect(await meta(page, 'property="og:image:type"'), path).toBe("image/png");
      expect(await meta(page, 'property="og:image:alt"'), path).toBe("Resource Hub, published by Colbination");
      // Next.js derives the Twitter card from the Open Graph fields; nothing is written for it.
      expect(await meta(page, 'name="twitter:card"'), path).toBe("summary_large_image");
      expect(await meta(page, 'name="twitter:image"'), path).toBe(content);
      const response = await request.get(content);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toMatch(/^image\/png/);
      const body = await response.body();
      expect(pngHeader(body), path).toEqual({ width: 1200, height: 630, colourType: 2 });
      bodies.push(body);
    }
    // Both forms carry the same content hash (Next.js hashes the file the
    // same way for each), and both serve the committed file's bytes.
    expect([...hashes]).toHaveLength(1);
    const committed = readFileSync(join(__dirname, "../app/opengraph-image.png"));
    for (const body of bodies) expect(body.equals(committed)).toBe(true);
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
    const content = (await fallback.getAttribute("content")) as string;
    expect(content.startsWith(`${site}/`)).toBe(true);
    expect(content).toMatch(HASHED_IMPORT);
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
