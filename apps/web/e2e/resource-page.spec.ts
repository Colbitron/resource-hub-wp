import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";

import { mockCms } from "./mock-cms/client.mts";
import { appSiteOrigin, E2E_REVALIDATE_SECRET, MOCK_CMS_HOST, mockCmsOrigin, mockCmsPort } from "./mock-cms/config.mts";
import { RESOURCES, TERMS } from "./mock-cms/seed.mts";
import { platformFonts } from "./platform-fonts.mts";
import { postRevalidate } from "./revalidation.mts";

/**
 * The single resource page at the real route `/resources/[type]/[slug]/`
 * against the built app and the mock CMS (ADRs 0025 and 0040; see
 * `packages/ui/README.md` and `docs/architecture/caching.md`): what it
 * renders, that the CMS's address is nowhere in the response, its metadata,
 * the redirect contract on the real route (one computed 308, then a 200; the
 * proxy's 308 for mixed case; a 404 for an unknown slug), what ISR stores and
 * what clears it (the 200, the 308 and the 404 are stored and served as
 * route-cache hits with the `headers()` rule's `Cache-Control`, and a resource
 * event clears a stored redirect at the old URL and a stored 404 at the new
 * one), the Chromium round trip that a browser-kept redirect would fail, that
 * the page and its metadata make one CMS request between them, and the page's
 * accessibility and layout stability.
 *
 * `e2e/redirects.spec.ts` keeps the decision's edge cases on the fixture
 * route, which renders on every request; this spec proves the real, stored
 * route sends the contract.
 *
 * Changes to the mock are followed by the revalidation event the CMS would
 * send, because the app's Data Cache does not see the mock change
 * (e2e/README.md); resources a test creates get a slug of this run's own.
 */

/** A seeded webinar (ID 33) with a rich body: CMS links, an upload with a `srcset`, the block marker. */
const SEEDED = { id: 33, type: "webinar", slug: "revalidation-from-the-editors-chair", title: "Revalidation from the editor’s chair" };
/** The seeded long-form article (ID 30): headings, lists, a quote, code, a table, a figure, a 1600×900 image. */
const LONG_FORM = { id: 30, type: "article", slug: "taxonomies-versus-meta" };

const cms = mockCms();

const RUN = Date.now().toString(36);

function unique(slug: string): string {
  return `${slug}-${RUN}`;
}

test.beforeEach(async () => {
  await cms.reset();
});

function resourcePath(type: string, slug: string): string {
  return `/resources/${type}/${slug}/`;
}

function get(request: APIRequestContext, path: string): Promise<APIResponse> {
  return request.get(path, { maxRedirects: 0 });
}

/**
 * The first `Location` value. A freshly rendered ISR 308 carries the header
 * twice with the same value (Next.js 16.4.5, measured: the stored copy has it
 * once), and Playwright joins repeated headers with a comma; every client
 * reads the first, and this checks they all agree.
 */
function location(response: APIResponse): string | undefined {
  const values = response.headersArray().filter((header) => header.name.toLowerCase() === "location").map((header) => header.value);
  expect(new Set(values).size, `one Location value, not ${JSON.stringify(values)}`).toBeLessThanOrEqual(1);
  return values[0];
}

/** The `Cache-Control` directives of a response, lower-cased and trimmed. */
function cacheDirectives(response: APIResponse): string[] {
  return (response.headers()["cache-control"] ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .filter((directive) => directive !== "");
}

async function expectOk(request: APIRequestContext, path: string): Promise<APIResponse> {
  const response = await get(request, path);
  expect(response.status(), `${path} should answer 200`).toBe(200);
  expect(location(response)).toBeUndefined();
  return response;
}

/**
 * The `Cache-Control` every response of the resource route carries, from the
 * `headers()` rule in `next.config.ts` (`lib/route-headers.ts`): a browser's
 * copy is stale at once and may not be used without asking, so a stored 308
 * is followed afresh each time. No `s-maxage`, which Next.js would otherwise
 * send alone, and no `no-store`, which would forbid the route cache's
 * purpose.
 */
function expectRevalidateEachTime(response: APIResponse, path: string): void {
  const directives = cacheDirectives(response);
  expect(directives, path).toContain("max-age=0");
  expect(directives, path).toContain("must-revalidate");
  expect(directives, path).not.toContain("no-store");
  expect(directives.some((directive) => directive.startsWith("s-maxage")), path).toBe(false);
}

/**
 * One 308 from `from` to `to`, and `to` a 200: a single hop. From the route
 * (`"stored"`): rendered once and then a route-cache hit, with the header
 * rule's `Cache-Control`. From the proxy (`"proxy"`): `no-store`, never from
 * any cache.
 */
async function expectRedirect(request: APIRequestContext, from: string, to: string, source: "stored" | "proxy" = "stored"): Promise<void> {
  const first = await get(request, from);
  expect(first.status(), `${from} should redirect`).toBe(308);
  expect(location(first)).toBe(to);
  if (source === "proxy") {
    expect(cacheDirectives(first)).toContain("no-store");
    expect(first.headers()["x-nextjs-cache"]).toBeUndefined();
  } else {
    expectRevalidateEachTime(first, from);
    expect(first.headers()["x-nextjs-cache"], from).toMatch(/^(MISS|HIT)$/);
  }
  await expectOk(request, to);
}

/** A second request for a stored response: the same status, answered from the route cache. */
async function expectStored(request: APIRequestContext, path: string, status: number): Promise<APIResponse> {
  const response = await get(request, path);
  expect(response.status(), `${path} should still answer ${status}`).toBe(status);
  expect(response.headers()["x-nextjs-cache"], `${path} should be a route-cache hit`).toBe("HIT");
  expectRevalidateEachTime(response, path);
  return response;
}

/** A schema-valid `update` event for resource `id` in its current state, with `previous` as given. */
async function updateEvent(id: number, previous: { slug?: string; type?: string }) {
  const { origin, resources } = await cms.state();
  const resource = resources.find((candidate) => candidate.id === id);
  if (resource === undefined || resource.type === null) throw new Error(`the mock has no typed resource ${id}`);
  return {
    type: "resource",
    event: "update",
    id,
    slug: resource.slug,
    rest_url: `${origin}/wp-json/wp/v2/resources/${id}`,
    types: [resource.type],
    topics: resource.topics,
    previous: { slug: previous.slug ?? resource.slug, types: [previous.type ?? resource.type], topics: resource.topics },
  };
}

async function revalidate(request: APIRequestContext, events: unknown[]): Promise<void> {
  const response = await postRevalidate(request, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
    data: JSON.stringify({ version: 1, events }),
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** Requests to the mock's REST API, by path and query, from its counters. */
async function restRequests(): Promise<Record<string, number>> {
  const { byPath } = await cms.requests();
  return Object.fromEntries(Object.entries(byPath).filter(([path]) => path.startsWith("/wp-json/")));
}

function seeded(id: number) {
  const resource = RESOURCES.find((candidate) => candidate.id === id);
  if (resource === undefined) throw new Error(`the seed has no resource ${id}`);
  return resource;
}

function termName(taxonomy: "resource_type" | "resource_topic", slug: string): string {
  const term = TERMS.find((candidate) => candidate.taxonomy === taxonomy && candidate.slug === slug);
  if (term === undefined) throw new Error(`no seeded ${taxonomy} ${slug}`);
  return term.name;
}

test.describe("what the page renders", () => {
  test("the title, the meta line, the featured image, the summary, the body and the source", async ({ page }) => {
    const resource = seeded(SEEDED.id);
    await page.goto(resourcePath(SEEDED.type, SEEDED.slug));

    const article = page.getByRole("article");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(article.getByRole("heading", { level: 1 })).toHaveText(SEEDED.title);

    // The type links to its listing, the date is a <time>, and each topic links to its listing.
    const typeLink = article.getByRole("link", { name: termName("resource_type", SEEDED.type) });
    await expect(typeLink).toHaveAttribute("href", `/resources/${SEEDED.type}/`);
    // The type mark is the row's (card-labels.css), on the span around the link and
    // not on the link, so the dot sits outside the link's text and underline;
    // a webinar's mark is coral (lib/type-accents.ts).
    const typeMark = article.locator(".rh-resource__meta .rh-card__type");
    await expect(typeMark).toHaveAttribute("data-accent", "coral");
    expect(await typeMark.evaluate((span) => getComputedStyle(span, "::before").width)).not.toBe("0px");
    expect(await typeLink.evaluate((link) => getComputedStyle(link, "::before").content)).toBe("none");
    const [markBox, linkBox] = [await typeMark.boundingBox(), await typeLink.boundingBox()];
    expect(markBox !== null && linkBox !== null && linkBox.x > markBox.x, "the dot sits before the link, outside it").toBe(true);
    const time = article.locator(".rh-resource__meta time");
    await expect(time).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    await expect(time).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    const topics = article.getByRole("list", { name: "Topics" }).getByRole("link");
    await expect(topics).toHaveText(resource.topics.map((slug) => termName("resource_topic", slug)));
    for (const [index, slug] of resource.topics.entries()) {
      await expect(topics.nth(index)).toHaveAttribute("href", `/resources/topic/${slug}/`);
    }

    // The featured image: same-origin through the optimizer, with its size reserved, loaded eagerly as the LCP candidate.
    const featured = article.locator(".rh-resource__media img");
    await expect(featured).toHaveAttribute("alt", "A content model diagram");
    await expect(featured).toHaveAttribute("width", "240");
    await expect(featured).toHaveAttribute("height", "160");
    expect(decodeURIComponent((await featured.getAttribute("src")) ?? "")).toContain("/media/2026/11/content-model.png");
    expect(await featured.evaluate((img) => (img as HTMLImageElement).loading)).not.toBe("lazy");
    await expect(page.locator('link[rel="preload"][as="image"]')).toHaveCount(1);
    // `preload` alone leaves the image at Low priority in Chromium; both the link and the <img> ask for High.
    await expect(page.locator('link[rel="preload"][as="image"]')).toHaveAttribute("fetchpriority", "high");
    await expect(featured).toHaveAttribute("fetchpriority", "high");
    // `sizes` is the column's width written out (`CONTENT_SIZES` in lib/content/render.tsx); the body's images carry the same string.
    await expect(featured).toHaveAttribute("sizes", "(max-width: 44rem) calc(-2rem + 100vw), 42rem");
    await expect(article.locator(".rh-resource__body figure img")).toHaveAttribute("sizes", "(max-width: 44rem) calc(-2rem + 100vw), 42rem");

    await expect(article.locator(".rh-resource__summary")).toHaveText(resource.summary);

    // The body: the CMS link made relative, the external link kept, the upload through /media/, the marker's fallback list.
    const body = article.locator(".rh-resource__body");
    await expect(body.getByRole("link", { name: "A field guide to revalidation" })).toHaveAttribute("href", "/resources/ebook/a-field-guide-to-revalidation/");
    await expect(body.getByRole("link", { name: "a write-up on another site" })).toHaveAttribute("href", "https://example.com/elsewhere/");
    const bodyImage = body.locator("figure img");
    expect(decodeURIComponent((await bodyImage.getAttribute("src")) ?? "")).toContain("/media/2026/11/content-model.png");
    await expect(body.getByRole("heading", { level: 2, name: "Related resources" })).toBeVisible();
    await expect(body.getByRole("link", { name: "Alt text at scale" })).toHaveAttribute("href", "/resources/article/alt-text-at-scale/");

    // The source: an external link, marked as one, shown by its host.
    const source = article.locator(".rh-resource__source a");
    await expect(source).toHaveAttribute("href", resource.sourceUrl);
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
    await expect(source).toHaveText("example.com");
  });

  test("a resource with no image, no summary and no source shows none of them", async ({ page }) => {
    const slug = unique("bare");
    await cms.createResource({ title: "Bare", type: "podcast", slug, summary: "", sourceUrl: "" });
    await page.goto(resourcePath("podcast", slug));
    const article = page.getByRole("article");
    await expect(article.getByRole("heading", { level: 1 })).toHaveText("Bare");
    await expect(article.locator(".rh-resource__media")).toHaveCount(0);
    await expect(article.locator(".rh-resource__summary")).toHaveCount(0);
    await expect(article.locator(".rh-resource__source")).toHaveCount(0);
    await expect(article.getByRole("list", { name: "Topics" })).toHaveCount(0);
    await expect(page.locator('meta[name="description"]')).toHaveCount(0);
  });

  test("a source on the CMS becomes /media/ for an upload and nothing for a page the front end does not serve", async ({ page }) => {
    const upload = unique("source-upload");
    await cms.createResource({ title: "Source upload", type: "ebook", slug: upload, sourceUrl: `${mockCmsOrigin()}/wp-content/uploads/2026/11/guide.pdf` });
    await page.goto(resourcePath("ebook", upload));
    const link = page.locator(".rh-resource__source a");
    await expect(link).toHaveAttribute("href", "/media/2026/11/guide.pdf");
    await expect(link).toHaveText("guide.pdf");
    await expect(link).not.toHaveAttribute("rel", /noopener/);

    const admin = unique("source-admin");
    await cms.createResource({ title: "Source admin", type: "ebook", slug: admin, sourceUrl: `${mockCmsOrigin()}/wp-admin/` });
    await page.goto(resourcePath("ebook", admin));
    await expect(page.locator(".rh-resource__source")).toHaveCount(0);
  });

  test("the long-form body renders every element the sanitiser allows", async ({ page }) => {
    await page.goto(resourcePath(LONG_FORM.type, LONG_FORM.slug));
    const body = page.locator(".rh-resource__body");
    await expect(body.getByRole("heading", { level: 2 })).toHaveCount(4);
    await expect(body.getByRole("heading", { level: 3 })).toHaveCount(1);
    await expect(body.locator("ul li")).toHaveCount(5);
    await expect(body.locator("ol li")).toHaveCount(3);
    await expect(body.locator("blockquote cite")).toHaveText("A rule of thumb from the plugin's first review");
    await expect(body.locator("pre code")).toContainText('"resource_type": [5]');
    await expect(body.getByRole("table")).toHaveCount(1);
    await expect(body.getByRole("columnheader")).toHaveText(["Question", "Term", "Field"]);
    await expect(body.locator("figure figcaption")).toHaveText("The content model: one post type, three taxonomies, two fields.");
    // The featured image is the `large` size: the smallest at least 800 wide of the same shape.
    const featured = page.locator(".rh-resource__media img");
    await expect(featured).toHaveAttribute("width", "1024");
    await expect(featured).toHaveAttribute("height", "576");
  });

  test("the featured image is requested at High priority", async ({ page }) => {
    // The DevTools protocol reports each request's priority as the browser first assigned it.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    const priorities: { url: string; priority: string }[] = [];
    cdp.on("Network.requestWillBeSent", (event) => {
      if (event.type === "Image") priorities.push({ url: event.request.url, priority: event.request.initialPriority });
    });
    await page.goto(resourcePath(LONG_FORM.type, LONG_FORM.slug));
    await page.waitForLoadState("networkidle");
    const src = await page.locator(".rh-resource__media img").evaluate((img) => (img as HTMLImageElement).currentSrc);
    const hero = priorities.filter(({ url }) => url === src);
    expect(hero.length, `a request for ${src} among ${JSON.stringify(priorities)}`).toBeGreaterThan(0);
    expect(hero[0].priority).toBe("High");
  });
});

test.describe("the CMS's address", () => {
  const NEEDLES = [mockCmsOrigin(), `${MOCK_CMS_HOST}:${mockCmsPort()}`, "wp-content", "wp-json"];

  // ID 33 has CMS links, an upload with a `srcset` and the block marker; ID 30 a featured image, so a preload link and `og:image`.
  for (const resource of [SEEDED, LONG_FORM]) {
    test(`is nowhere in the HTML, the head included (ID ${resource.id})`, async ({ request }) => {
      const html = await (await expectOk(request, resourcePath(resource.type, resource.slug))).text();
      expect(html).toContain("<title>");
      expect(html).toContain("self.__next_f.push");
      if (resource === LONG_FORM) {
        expect(html).toContain('property="og:image"');
        expect(html).toContain('rel="preload"');
      }
      for (const needle of NEEDLES) {
        expect(html, `the HTML must not contain ${needle}`).not.toContain(needle);
      }
    });
  }

  test("is nowhere in the RSC payloads a client navigation is built from, prefetched or fetched on the click", async ({ page }) => {
    // From the type listing, as a reader would arrive. The row is prefetched
    // while the listing is open (its route tree and page segment; ADR 0043),
    // so the click is served from those responses and fetches nothing new,
    // or fetches the page's payload when the prefetch has not landed. Every
    // RSC response for the resource's path is read, whichever way it came.
    const payloads: Promise<string>[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === resourcePath(SEEDED.type, SEEDED.slug) && response.request().headers()["rsc"] === "1") {
        payloads.push(response.text());
      }
    });
    await page.goto(`/resources/${SEEDED.type}/`);
    await page.getByRole("link", { name: SEEDED.title }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SEEDED.title);
    const texts = await Promise.all(payloads);
    // The page's own markup is in one of them (the flight payload may escape the title's curly apostrophe, so the class is the check).
    expect(texts.some((text) => text.includes("rh-resource__body")), "no RSC response carried the page").toBe(true);
    for (const text of texts) {
      for (const needle of NEEDLES) {
        expect(text, `an RSC payload must not contain ${needle}`).not.toContain(needle);
      }
    }
  });
});

test.describe("metadata", () => {
  test("the title, the description, the canonical and the Open Graph fields", async ({ page }) => {
    const resource = seeded(SEEDED.id);
    await page.goto(resourcePath(SEEDED.type, SEEDED.slug));
    await expect(page).toHaveTitle(`${SEEDED.title} | Resource Hub`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", resource.summary);
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    expect(new URL((await canonical.getAttribute("href")) as string, page.url()).pathname).toBe(resourcePath(SEEDED.type, SEEDED.slug));
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", SEEDED.title);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
    const ogImage = page.locator('meta[property="og:image"]');
    expect(new URL((await ogImage.getAttribute("content")) as string, page.url()).pathname).toBe("/media/2026/11/content-model.png");
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "240");
  });

  test("og:image is the smallest size at least 1200 wide, while the page keeps the card's size", async ({ page }) => {
    // ID 30's 1600×900 upload has sizes 768, 1024 and 1536 wide: the page takes 1024 and og:image 1536.
    // The fall-back to the original is in the test above: ID 33's upload is 240 wide.
    await page.goto(resourcePath(LONG_FORM.type, LONG_FORM.slug));
    const ogImage = page.locator('meta[property="og:image"]');
    expect(new URL((await ogImage.getAttribute("content")) as string, page.url()).pathname).toBe("/media/2026/11/taxonomies-versus-meta-1536x864.png");
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1536");
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "864");
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", "Three boxes joined by two bars: a term, a post and a field");
    await expect(page.locator(".rh-resource__media img")).toHaveAttribute("width", "1024");
  });

  test("a resource with a featured image gets the large X card, with Next.js's twitter:* copies of its og:* fields", async ({ page }) => {
    // ID 30 has a 1600×900 featured image. Only the card type is set by the app; Next.js copies the rest from og:*.
    await page.goto(resourcePath(LONG_FORM.type, LONG_FORM.slug));
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveCount(1);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const og = async (property: string) => (await page.locator(`meta[property="og:${property}"]`).getAttribute("content")) as string;
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", await og("title"));
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", await og("image"));
    await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute("content", await og("image:alt"));
  });

  test("a resource with no featured image gets the default share image and so the large X card, with Next.js's twitter:* copies", async ({ page }) => {
    // The default is named by the route itself (lib/share-image.ts); the card type is still the app's, the rest Next.js's copy.
    const slug = unique("no-image-card");
    await cms.createResource({ title: "No image card", type: "article", slug });
    await page.goto(resourcePath("article", slug));
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "No image card");
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/_next\/static\/media\/opengraph-image\.[^./]+\.png$/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveCount(1);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const og = async (property: string) => (await page.locator(`meta[property="og:${property}"]`).getAttribute("content")) as string;
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", await og("image"));
    await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute("content", await og("image:alt"));
  });

  test("a listing and both kinds of 404 write no Open Graph of their own: the file-based share image is their one og:image, and Next.js derives the large X card from it", async ({ page }) => {
    // A listing; a path decided from data (an unknown resource, components/DataNotFound.tsx); a path decided from its shape (the proxy's /404).
    // Next.js fills og:title and the twitter:* copies around the image itself; the app writes none of it.
    for (const path of ["/resources/", resourcePath("article", unique("no-such-resource")), "/robots.txt"]) {
      await page.goto(path);
      await expect(page.locator('meta[property="og:image"]'), path).toHaveCount(1);
      await expect(page.locator('meta[property="og:image"]'), path).toHaveAttribute("content", /\/opengraph-image\.png\?opengraph-image\.[^./]+\.png$/);
      await expect(page.locator('meta[name="twitter:card"]'), path).toHaveCount(1);
      await expect(page.locator('meta[name="twitter:card"]'), path).toHaveAttribute("content", "summary_large_image");
      const image = (await page.locator('meta[property="og:image"]').getAttribute("content")) as string;
      await expect(page.locator('meta[name="twitter:image"]'), path).toHaveAttribute("content", image);
    }
  });

  test("with SITE_URL set, the canonical, og:url, og:image and twitter:image are absolute on the site's origin and never name the CMS", async ({ page }) => {
    const site = appSiteOrigin();
    const checks: [string, string][] = [
      [resourcePath(SEEDED.type, SEEDED.slug), resourcePath(SEEDED.type, SEEDED.slug)],
      ["/resources/", "/resources/"],
      [`/resources/${SEEDED.type}/`, `/resources/${SEEDED.type}/`],
    ];
    for (const [path, expected] of checks) {
      await page.goto(path);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical, path).toBe(`${site}${expected}`);
      const urls = [canonical as string];
      const ogUrl = page.locator('meta[property="og:url"]');
      if ((await ogUrl.count()) > 0) {
        const content = (await ogUrl.getAttribute("content")) as string;
        expect(content, `${path} og:url`).toBe(`${site}${expected}`);
        urls.push(content);
      }
      // A resource's own image is under `/media/`; a listing carries the site's default share image, by its
      // file-based route, and a route that writes its own `openGraph` names its static import (brand.spec.ts).
      for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
        for (const image of await page.locator(selector).evaluateAll((metas) => metas.map((meta) => meta.getAttribute("content") ?? ""))) {
          const own = image.startsWith(`${site}/media/`);
          const fallback = image.startsWith(`${site}/opengraph-image.png`) || image.startsWith(`${site}/_next/static/media/opengraph-image.`);
          expect(own || fallback, `${path} ${selector} ${image}`).toBe(true);
          urls.push(image);
        }
      }
      for (const url of urls) {
        expect(url, path).not.toContain(mockCmsOrigin());
        expect(url, path).not.toContain(`:${mockCmsPort()}`);
        expect(url, path).not.toContain("wp-json");
      }
    }
    // The resource page sets og:url, og:image and twitter:image; this is not a check that passed by skipping them.
    await page.goto(resourcePath(SEEDED.type, SEEDED.slug));
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `${site}${resourcePath(SEEDED.type, SEEDED.slug)}`);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", `${site}/media/2026/11/content-model.png`);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", `${site}/media/2026/11/content-model.png`);
  });

  test("the page and its metadata make one CMS request between them", async ({ request }) => {
    const slug = unique("one-request");
    await cms.createResource({ title: "One request", type: "article", slug });
    await cms.resetRequests();

    // A render: one slug lookup, never resolve.
    await expectOk(request, resourcePath("article", slug));
    let requests = await restRequests();
    expect(requests[`/wp-json/wp/v2/resources?_embed&slug=${slug}`]).toBe(1);
    expect(Object.keys(requests).filter((path) => path.includes("/resolve"))).toEqual([]);

    // A redirect: the lookup is in the Data Cache, so no request at all.
    await cms.resetRequests();
    await expectRedirect(request, resourcePath("webinar", slug), resourcePath("article", slug));
    expect(await restRequests()).toEqual({});

    // A 404: the miss is one cached lookup and one resolve request, whose miss the Data
    // Cache never stores; the route cache stores the 404 itself, so a second request for
    // the same URL asks the CMS nothing (see `docs/architecture/caching.md`).
    const missing = unique("missing");
    await cms.resetRequests();
    await expectNotFound(request, resourcePath("article", missing));
    requests = await restRequests();
    expect(requests[`/wp-json/wp/v2/resources?_embed&slug=${missing}`]).toBe(1);
    expect(requests[`/wp-json/resource-hub/v1/resolve?slug=${missing}`]).toBe(1);
    await expectStored(request, resourcePath("article", missing), 404);
    requests = await restRequests();
    expect(requests[`/wp-json/wp/v2/resources?_embed&slug=${missing}`]).toBe(1);
    expect(requests[`/wp-json/resource-hub/v1/resolve?slug=${missing}`]).toBe(1);
  });
});

async function expectNotFound(request: APIRequestContext, path: string): Promise<void> {
  const response = await get(request, path);
  expect(response.status(), `${path} should be a 404`).toBe(404);
}

test.describe("the redirect contract on the real route", () => {
  test("the canonical URL is a 200 stored by ISR: the second request is a route-cache hit with the header rule's Cache-Control", async ({ request }) => {
    const path = resourcePath(SEEDED.type, SEEDED.slug);
    const first = await expectOk(request, path);
    expectRevalidateEachTime(first, path);
    expect(first.headers()["x-nextjs-cache"]).toMatch(/^(MISS|HIT)$/);
    await expectStored(request, path, 200);
  });

  test("a wrong type segment is one 308 to the canonical URL, which answers 200, and the 308 is stored like the page", async ({ request }) => {
    await expectRedirect(request, resourcePath("podcast", SEEDED.slug), resourcePath(SEEDED.type, SEEDED.slug));
    await expectRedirect(request, resourcePath("no-such-type", SEEDED.slug), resourcePath(SEEDED.type, SEEDED.slug));
    const stored = await expectStored(request, resourcePath("podcast", SEEDED.slug), 308);
    expect(location(stored)).toBe(resourcePath(SEEDED.type, SEEDED.slug));
  });

  test("an old slug, after a rename, is one 308 to the new URL", async ({ request }) => {
    const before = unique("rename-before");
    const after = unique("rename-after");
    const { id } = await cms.createResource({ title: "Rename me", type: "article", slug: before });
    await expectOk(request, resourcePath("article", before));

    await cms.renameSlug(id, after);
    await revalidate(request, [await updateEvent(id, { slug: before })]);

    await expectRedirect(request, resourcePath("article", before), resourcePath("article", after));
    await expectRedirect(request, resourcePath("webinar", before), resourcePath("article", after));
  });

  test("a segment in mixed case is one 308 from the proxy, with no-store, to the lower-case URL", async ({ request }) => {
    const canonical = resourcePath(SEEDED.type, SEEDED.slug);
    await expectRedirect(request, resourcePath("Webinar", SEEDED.slug), canonical, "proxy");
    await expectRedirect(request, resourcePath(SEEDED.type, "Revalidation-From-The-Editors-Chair"), canonical, "proxy");
    // Wrong type and mixed case together: the proxy lower-cases, the page redirects the type; two decisions, still one hop each.
    const first = await get(request, resourcePath("PODCAST", SEEDED.slug));
    expect(first.status()).toBe(308);
    expect(location(first)).toBe(resourcePath("podcast", SEEDED.slug));
    expect(cacheDirectives(first)).toContain("no-store");
    expect(first.headers()["x-nextjs-cache"]).toBeUndefined();
  });

  test("an unknown slug, a reserved type and an invalid slug are 404s, and an unknown slug's 404 is stored", async ({ request }) => {
    const missing = resourcePath("webinar", unique("no-such-resource"));
    await expectNotFound(request, missing);
    await expectStored(request, missing, 404);
    await expectNotFound(request, resourcePath("topic", SEEDED.slug));
    await expectNotFound(request, resourcePath("page", SEEDED.slug));
    await expectNotFound(request, resourcePath("webinar", "a".repeat(201)));
  });

  test("a resource event clears a stored 404 at the new slug and a stored 308 at the old one", async ({ request }) => {
    const before = unique("stored-before");
    const after = unique("stored-after");
    const { id } = await cms.createResource({ title: "Stored", type: "article", slug: before });
    await expectOk(request, resourcePath("article", before));
    // The new slug's 404 is stored before the rename happens.
    await expectNotFound(request, resourcePath("article", after));
    await expectStored(request, resourcePath("article", after), 404);

    await cms.renameSlug(id, after);
    await revalidate(request, [await updateEvent(id, { slug: before })]);
    // The event named both paths and both `resource:` tags: the 404 is gone and the old path is a 308, which is then stored.
    await expectOk(request, resourcePath("article", after));
    await expectRedirect(request, resourcePath("article", before), resourcePath("article", after));
    const stored = await expectStored(request, resourcePath("article", before), 308);
    expect(location(stored)).toBe(resourcePath("article", after));

    // Renamed back: the stored 308 at the old path must not survive the event, or it would redirect to a 308 the other way.
    await cms.renameSlug(id, before);
    await revalidate(request, [await updateEvent(id, { slug: after })]);
    await expectOk(request, resourcePath("article", before));
    await expectRedirect(request, resourcePath("article", after), resourcePath("article", before));
  });

  test("a type changed and changed back: each step answers a single-hop 308, with the stored one cleared by the event", async ({ request }) => {
    const slug = unique("round-trip");
    const { id } = await cms.createResource({ title: "Round trip", type: "webinar", slug });
    const asWebinar = resourcePath("webinar", slug);
    const asPodcast = resourcePath("podcast", slug);
    await expectOk(request, asWebinar);
    await expectRedirect(request, asPodcast, asWebinar);
    await expectStored(request, asPodcast, 308);

    // webinar -> podcast: the stored 200 and the stored 308 both carry `resource:{slug}`, which the event clears.
    await cms.setType(id, "podcast");
    await revalidate(request, [await updateEvent(id, { type: "webinar" })]);
    await expectRedirect(request, asWebinar, asPodcast);
    await expectStored(request, asWebinar, 308);
    await expectStored(request, asPodcast, 200);

    await cms.setType(id, "webinar");
    await revalidate(request, [await updateEvent(id, { type: "podcast" })]);
    await expectOk(request, asWebinar);
    await expectRedirect(request, asPodcast, asWebinar);
  });
});

/** One navigation's redirect, as Chromium's network layer reported it. */
interface BrowserHop {
  from: string;
  status: number;
  cacheControl: string;
  fromCache: boolean;
}

/**
 * Records every redirect Chromium follows on `page`, and whether its disk or
 * memory cache answered it instead of the server, from the DevTools
 * protocol, which reports a cached redirect that Playwright's events do not
 * mark (the technique of `e2e/redirects.spec.ts`).
 */
async function watchRedirects(page: Page): Promise<BrowserHop[]> {
  const hops: BrowserHop[] = [];
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  session.on("Network.requestWillBeSent", (event) => {
    const redirect = event.redirectResponse;
    if (redirect === undefined) return;
    const cacheControl = Object.entries(redirect.headers).find(([name]) => name.toLowerCase() === "cache-control")?.[1] ?? "";
    hops.push({
      from: new URL(redirect.url).pathname,
      status: redirect.status,
      cacheControl: String(cacheControl),
      fromCache: redirect.fromDiskCache === true || redirect.fromPrefetchCache === true || redirect.fromServiceWorker === true,
    });
  });
  return hops;
}

/** Navigates Chromium to `from` and expects it to land on `to`, titled `title`, through at most one redirect that came from the server with `max-age=0`, never from Chromium's cache. */
async function expectBrowserLands(page: Page, hops: BrowserHop[], from: string, to: string, title: string): Promise<void> {
  hops.length = 0;
  const response = await page.goto(from);
  expect(new URL(page.url()).pathname, `${from} should land on ${to}`).toBe(to);
  expect(response?.status(), `${to} should answer 200`).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  const canonical = page.locator('link[rel="canonical"]');
  expect(new URL((await canonical.getAttribute("href")) as string, page.url()).pathname).toBe(to);
  expect(hops, `the redirects followed from ${from}`).toEqual(
    from === to ? [] : [{ from, status: 308, cacheControl: expect.stringMatching(/max-age=0/), fromCache: false }],
  );
}

test("in Chromium, a type changed and changed back lands on the current URL at every step, the stored 308 included", async ({ page, request }) => {
  const slug = unique("browser-round-trip");
  const title = `Browser round trip ${RUN}`;
  const { id } = await cms.createResource({ title, type: "webinar", slug });
  const asWebinar = resourcePath("webinar", slug);
  const asPodcast = resourcePath("podcast", slug);
  const hops = await watchRedirects(page);

  await expectBrowserLands(page, hops, asWebinar, asWebinar, title);
  // Twice: the second time the 308 is a route-cache hit, and Chromium must still ask the server for it.
  await expectBrowserLands(page, hops, asPodcast, asWebinar, title);
  await expectBrowserLands(page, hops, asPodcast, asWebinar, title);

  // webinar -> podcast: a kept podcast -> webinar redirect would now loop.
  await cms.setType(id, "podcast");
  await revalidate(request, [await updateEvent(id, { type: "webinar" })]);
  await expectBrowserLands(page, hops, asPodcast, asPodcast, title);
  await expectBrowserLands(page, hops, asWebinar, asPodcast, title);

  // podcast -> webinar: a kept webinar -> podcast redirect would now loop.
  await cms.setType(id, "webinar");
  await revalidate(request, [await updateEvent(id, { type: "podcast" })]);
  await expectBrowserLands(page, hops, asWebinar, asWebinar, title);
  await expectBrowserLands(page, hops, asPodcast, asWebinar, title);
});

test.describe("accessibility and layout", () => {
  test("landmarks, one h1, named links, images with alt text, and the skip link reaches the article", async ({ page }) => {
    await page.goto(resourcePath(LONG_FORM.type, LONG_FORM.slug));
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(await page.locator("html").getAttribute("lang")).toBe("en");

    // Every link has a name and every image has an alt attribute.
    const unnamedLinks = await page.getByRole("link").evaluateAll((links) => links.filter((link) => (link.textContent ?? "").trim() === "" && !link.getAttribute("aria-label")).length);
    expect(unnamedLinks).toBe(0);
    const imagesWithoutAlt = await page.locator("img").evaluateAll((images) => images.filter((img) => !img.hasAttribute("alt")).length);
    expect(imagesWithoutAlt).toBe(0);

    // Heading levels never skip downwards by more than one.
    const levels = await page.locator("h1, h2, h3, h4, h5, h6").evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1], `heading levels ${levels.join(", ")}`).toBeLessThanOrEqual(1);
    }

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("the featured image never renders wider than its `sizes` claims, at 1280px and at 360px", async ({ page }) => {
    // The column is `--rh-measure`, 65ch, and `sizes` is that width written
    // out in rem (`CONTENT_SIZES` in lib/content/render.tsx): 42rem above a
    // 44rem viewport, the viewport less the two 1rem gutters below it. A
    // `sizes` under the rendered width would have the browser pick a
    // candidate too small for the box, so a change to the measure or the
    // typeface that moves 65ch past 42rem fails here until the string
    // follows. The long-form resource's upload is 1600 wide, so the column,
    // not the file, bounds the image.
    const rootFontSize = (): Promise<number> => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(resourcePath(LONG_FORM.type, LONG_FORM.slug));
    const image = page.locator(".rh-resource__media img");
    await expect(image).toHaveAttribute("sizes", "(max-width: 44rem) calc(-2rem + 100vw), 42rem");
    // A `ch` is the font's, so the column is measured once the page is drawn in Figtree, not in the fallback face.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const title = page.locator("h1");
    await expect
      .poll(async () => (await platformFonts(page, "h1")).filter((family) => !/^Figtree\b/.test(family)).length, { message: "the title was not drawn in Figtree" })
      .toBe(0);
    expect((await platformFonts(page, "h1")).length).toBeGreaterThan(0);
    await expect(title).toBeVisible();
    const wide = await image.boundingBox();
    expect(wide).not.toBeNull();
    // The column as this browser draws it: a probe `--rh-measure` wide inside
    // the article, so in the article's font. A `ch` is the advance of the
    // font's "0" as the platform lays it out, which is not one number:
    // Chromium on macOS draws 65ch of Figtree at 16px as 666.45px, and on
    // Linux, which rounds each advance to a whole pixel, as 650px. So the
    // floor is the measured column, not a width in rem.
    const measured = await page.getByRole("article").evaluate((article) => {
      const probe = document.createElement("div");
      probe.style.cssText = "position: absolute; visibility: hidden; width: var(--rh-measure)";
      article.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    });
    expect(Math.abs(wide!.width - measured), `the image is ${wide!.width}px wide in a ${measured}px column`).toBeLessThanOrEqual(1);
    // The ceiling: `sizes` never understates the column. 42rem is 5.5px over
    // it on macOS and 22px over it on Linux.
    expect(measured).toBeLessThanOrEqual(42 * (await rootFontSize()));
    expect(wide!.width).toBeLessThanOrEqual(42 * (await rootFontSize()));

    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(resourcePath(LONG_FORM.type, LONG_FORM.slug));
    const narrow = await image.boundingBox();
    expect(narrow).not.toBeNull();
    // Below 44rem the claim is `calc(-2rem + 100vw)`, and the column is exactly that: the viewport less the shell's gutters.
    const column = (await page.evaluate(() => document.documentElement.clientWidth)) - 2 * (await rootFontSize());
    expect(narrow!.width).toBeLessThanOrEqual(column);
    expect(narrow!.width).toBeGreaterThan(column - 1);
  });

  test("at 360px nothing scrolls horizontally, no table cell breaks a word, and the page does not shift as it loads", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(resourcePath(LONG_FORM.type, LONG_FORM.slug));
    await page.waitForLoadState("networkidle");
    // Give any late image a moment to decode and settle.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));

    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);

    // No word in a table cell is broken across lines: each word's text sits on one line box.
    const splitWords = await page.locator(".rh-resource__body td, .rh-resource__body th").evaluateAll((cells) => {
      const split: string[] = [];
      for (const cell of cells) {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const text = node.textContent ?? "";
          for (const match of text.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const tops = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)));
            if (tops.size > 1) split.push(match[0]);
          }
        }
      }
      return split;
    });
    expect(splitWords, "table cell words broken across lines at 360px").toEqual([]);
    await expect(page.getByRole("table")).toHaveCount(1);

    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as PerformanceEntry[]) {
              const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
              if (!shift.hadRecentInput) total += shift.value ?? 0;
            }
          });
          observer.observe({ type: "layout-shift", buffered: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(total);
          }, 100);
        }),
    );
    expect(cls, "cumulative layout shift at 360px").toBeLessThanOrEqual(0.01);
  });
});

/** Eight columns of words too long to wrap: wider than a 360px column whatever the cells do. */
const WIDE_TABLE =
  '<figure class="wp-block-table"><table><caption>Release matrix</caption>' +
  `<thead><tr>${Array.from({ length: 8 }, (_, i) => `<th>Heading${i}Supercalifragilistic</th>`).join("")}</tr></thead>` +
  `<tbody><tr>${Array.from({ length: 8 }, (_, i) => `<td>Cell${i}Antidisestablishment</td>`).join("")}</tr></tbody>` +
  "</table><figcaption>The figure's own caption</figcaption></figure>";

/** A body with an editor's h1 and levels out of order, a wide captioned table and a small table with no caption. */
const TABLES_AND_HEADINGS =
  "<h1>The editor's heading</h1><p>Intro.</p><h3>A deeper heading</h3><p>More.</p><h2>A second-level heading</h2>" +
  WIDE_TABLE +
  "<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>";

test.describe("the body's tables and headings", () => {
  /** Publishes a resource with `TABLES_AND_HEADINGS` under a slug of this run's own, so no cached read applies. */
  async function tablesResource(): Promise<string> {
    const slug = unique("tables-and-headings");
    await cms.createResource({ title: "Tables and headings", type: "article", slug, content: TABLES_AND_HEADINGS });
    return resourcePath("article", slug);
  }

  test("an editor's h1, h3 and h2 render as h2, h4 and h3, under the page's one h1", async ({ page }) => {
    await page.goto(await tablesResource());
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tables and headings");
    const body = await page.locator(".rh-resource__body").locator("h1, h2, h3, h4, h5, h6").evaluateAll((headings) =>
      headings.map((heading) => `${heading.tagName.toLowerCase()} ${heading.textContent}`),
    );
    expect(body).toEqual(["h2 The editor's heading", "h4 A deeper heading", "h3 A second-level heading"]);
  });

  test("each table is in a region named by its caption, or \"Table\", that wraps the table and not its figure", async ({ page }) => {
    await page.goto(await tablesResource());
    const regions = page.locator(".rh-resource__body .rh-table-scroll");
    await expect(regions).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Release matrix" })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Table", exact: true })).toHaveCount(1);
    // The wide table's region sits inside its figure, with the figure's caption after it.
    await expect(page.locator("figure.wp-block-table > .rh-table-scroll + figcaption")).toHaveCount(1);
    await expect(page.locator(".rh-table-scroll > table")).toHaveCount(2);
  });

  test("at 360px a wide table scrolls inside its region, by keyboard too, and the page does not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(await tablesResource());
    const region = page.getByRole("region", { name: "Release matrix" });

    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll, "the page scrolls sideways").toBeLessThanOrEqual(widths.client);
    const box = await region.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(box.scroll, "the wide table should overflow its region").toBeGreaterThan(box.client);
    expect(box.client).toBeLessThanOrEqual(widths.client);

    // Tab reaches the region (it is a tab stop of its own), and the arrow keys scroll it.
    let reached = false;
    for (let presses = 0; presses < 40 && !reached; presses += 1) {
      await page.keyboard.press("Tab");
      reached = await region.evaluate((element) => element === document.activeElement);
    }
    expect(reached, "Tab never reached the table's region").toBe(true);
    const outline = await region.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline, "the focused region shows no focus ring").not.toBe("none");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  });

  test("axe finds no scrollable region a keyboard cannot reach", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(await tablesResource());
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const results = await page.evaluate(
      () =>
        (window as unknown as { axe: { run(context: Document, options: object): Promise<AxeResults> } }).axe.run(document, {
          runOnly: { type: "rule", values: ["scrollable-region-focusable"] },
        }),
    );
    expect(results.violations.map((violation) => violation.nodes.map((node) => node.html))).toEqual([]);
    // The rule did look at the wide table's region, which is scrollable.
    expect(results.passes.flatMap((pass) => pass.nodes.map((node) => node.html)).some((html) => html.includes("Release matrix"))).toBe(true);
  });
});

/**
 * Three boxed tables, one with a footer after its body and one with the
 * footer first (HTML allows either order; the browser draws it last), and
 * one table in a link, which the pass leaves without a region, so unboxed.
 */
const TABLE_RULES =
  '<table><caption>Body only</caption><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody></table>' +
  '<table><caption>Footer last</caption><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody><tfoot><tr><td>Total</td></tr></tfoot></table>' +
  '<table><caption>Footer first</caption><tfoot><tr><td>Total</td></tr></tfoot><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody></table>' +
  '<a href="/resources/"><table><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody></table></a>' +
  "<blockquote><p>A quote.</p></blockquote>";

test.describe("the body's insets", () => {
  async function insetsResource(): Promise<string> {
    const slug = unique("insets");
    await cms.createResource({ title: "Insets", type: "article", slug, content: TABLE_RULES });
    return resourcePath("article", slug);
  }

  test("a boxed table's last row draws no rule, the row above a footer keeps one, and an unboxed table keeps them all", async ({ page }) => {
    await page.goto(await insetsResource());
    // Each table's rows, in the order they are drawn (the footer last), with the width of each row's bottom rule.
    const rules = await page.locator(".rh-resource__body table").evaluateAll((tables) =>
      tables.map((table) => ({
        boxed: table.parentElement?.classList.contains("rh-table-scroll") ?? false,
        rules: [...(table as HTMLTableElement).rows]
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
          .map((row) => getComputedStyle(row.cells[0]).borderBottomWidth),
      })),
    );
    expect(rules).toEqual([
      { boxed: true, rules: ["1px", "0px"] },
      { boxed: true, rules: ["1px", "1px", "0px"] },
      { boxed: true, rules: ["1px", "1px", "0px"] },
      { boxed: false, rules: ["1px", "1px"] },
    ]);
  });

  test("under forced colours the quote's bar is clearly wider than its box's edge", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(await insetsResource());
    const widths = await page
      .locator(".rh-resource__body blockquote")
      .evaluate((quote) => [getComputedStyle(quote).borderLeftWidth, getComputedStyle(quote).borderTopWidth].map(parseFloat));
    expect(widths[0]).toBeGreaterThanOrEqual(widths[1] * 3);
  });

  test("the featured image loads into the raised surface, and a body image, which may be transparent, onto the page", async ({ page }) => {
    await page.goto(resourcePath(LONG_FORM.type, LONG_FORM.slug));
    const background = (selector: string) => page.locator(selector).first().evaluate((img) => getComputedStyle(img).backgroundColor);
    expect(await background(".rh-resource__media img")).not.toBe("rgba(0, 0, 0, 0)");
    expect(await background(".rh-resource__body img")).toBe("rgba(0, 0, 0, 0)");
  });
});
