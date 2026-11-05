import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { E2E_REVALIDATE_SECRET, MOCK_CMS_HOST, mockCmsOrigin, mockCmsPort } from "./mock-cms/config.mts";
import { RESOURCES, TERMS } from "./mock-cms/seed.mts";

/**
 * The single resource page at the real route `/resources/[type]/[slug]/`
 * against the built app and the mock CMS (root `CLAUDE.md`, "Public URLs",
 * "Server side only" and "Block marker"; ADRs 0035, 0037, 0040 and 0047):
 * what it renders, that the CMS's address is nowhere in the response, its
 * metadata, the redirect contract on the real route (one computed 308 with
 * `no-store`, then a 200; the proxy's 308 for mixed case; a 404 for an
 * unknown slug), the Chromium round trip that a stored redirect would fail,
 * that the page and its metadata make one CMS request between them, and the
 * page's accessibility and layout stability.
 *
 * `e2e/redirects.spec.ts` keeps the same contract on the fixture route with
 * every edge case; this spec proves the real route sends it.
 *
 * Changes to the mock are followed by the revalidation event the CMS would
 * send, because the app's Data Cache does not see the mock change
 * (e2e/README.md); resources a test creates get a slug of this run's own.
 */

const ROUTE = "/api/revalidate/";
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
  expect(response.headers().location).toBeUndefined();
  return response;
}

/** One 308 from `from` to `to`, with `no-store`, not from a route cache, and `to` a 200: a single hop. */
async function expectRedirect(request: APIRequestContext, from: string, to: string): Promise<void> {
  const first = await get(request, from);
  expect(first.status(), `${from} should redirect`).toBe(308);
  expect(first.headers().location).toBe(to);
  expect(cacheDirectives(first)).toContain("no-store");
  expect(cacheDirectives(first).some((directive) => directive.startsWith("s-maxage"))).toBe(false);
  expect(first.headers()["x-nextjs-cache"]).toBeUndefined();
  await expectOk(request, to);
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
  const response = await request.post(ROUTE, {
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
    await expect(article.getByRole("link", { name: termName("resource_type", SEEDED.type) })).toHaveAttribute("href", `/resources/${SEEDED.type}/`);
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

  test("is nowhere in the RSC payload a client navigation fetches", async ({ page }) => {
    // From the type listing, as a reader would arrive: the click fetches the page's RSC payload.
    await page.goto(`/resources/${SEEDED.type}/`);
    const link = page.getByRole("link", { name: SEEDED.title });
    const payload = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === resourcePath(SEEDED.type, SEEDED.slug) &&
        response.request().headers()["rsc"] === "1" &&
        response.request().headers()["next-router-prefetch"] === undefined,
    );
    await link.click();
    const text = await (await payload).text();
    // The page's own markup is in it (the flight payload may escape the title's curly apostrophe, so the class is the check).
    expect(text).toContain("rh-resource__body");
    for (const needle of NEEDLES) {
      expect(text, `the RSC payload must not contain ${needle}`).not.toContain(needle);
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SEEDED.title);
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

    // A 404: the miss is one cached lookup, and resolve, whose miss is never cached, is asked once per request.
    const missing = unique("missing");
    await cms.resetRequests();
    await expectNotFound(request, resourcePath("article", missing));
    requests = await restRequests();
    expect(requests[`/wp-json/wp/v2/resources?_embed&slug=${missing}`]).toBe(1);
    expect(requests[`/wp-json/resource-hub/v1/resolve?slug=${missing}`]).toBe(1);
    await expectNotFound(request, resourcePath("article", missing));
    requests = await restRequests();
    expect(requests[`/wp-json/wp/v2/resources?_embed&slug=${missing}`]).toBe(1);
    expect(requests[`/wp-json/resource-hub/v1/resolve?slug=${missing}`]).toBe(2);
  });
});

async function expectNotFound(request: APIRequestContext, path: string): Promise<void> {
  const response = await get(request, path);
  expect(response.status(), `${path} should be a 404`).toBe(404);
}

test.describe("the redirect contract on the real route", () => {
  test("the canonical URL is a 200 that is never stored", async ({ request }) => {
    const response = await expectOk(request, resourcePath(SEEDED.type, SEEDED.slug));
    expect(cacheDirectives(response)).toContain("no-store");
    expect(response.headers()["x-nextjs-cache"]).toBeUndefined();
  });

  test("a wrong type segment is one 308 with no-store to the canonical URL, which answers 200", async ({ request }) => {
    await expectRedirect(request, resourcePath("podcast", SEEDED.slug), resourcePath(SEEDED.type, SEEDED.slug));
    await expectRedirect(request, resourcePath("no-such-type", SEEDED.slug), resourcePath(SEEDED.type, SEEDED.slug));
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

  test("a segment in mixed case is one 308 from the proxy to the lower-case URL", async ({ request }) => {
    const canonical = resourcePath(SEEDED.type, SEEDED.slug);
    await expectRedirect(request, resourcePath("Webinar", SEEDED.slug), canonical);
    await expectRedirect(request, resourcePath(SEEDED.type, "Revalidation-From-The-Editors-Chair"), canonical);
    // Wrong type and mixed case together: the proxy lower-cases, the page redirects the type; two decisions, still one hop each.
    const first = await get(request, resourcePath("PODCAST", SEEDED.slug));
    expect(first.status()).toBe(308);
    expect(first.headers().location).toBe(resourcePath("podcast", SEEDED.slug));
    expect(cacheDirectives(first)).toContain("no-store");
  });

  test("an unknown slug, a reserved type and an invalid slug are 404s", async ({ request }) => {
    await expectNotFound(request, resourcePath("webinar", unique("no-such-resource")));
    await expectNotFound(request, resourcePath("topic", SEEDED.slug));
    await expectNotFound(request, resourcePath("page", SEEDED.slug));
    await expectNotFound(request, resourcePath("webinar", "a".repeat(201)));
  });

  test("a type changed and changed back: each step answers a fresh single-hop 308", async ({ request }) => {
    const slug = unique("round-trip");
    const { id } = await cms.createResource({ title: "Round trip", type: "webinar", slug });
    const asWebinar = resourcePath("webinar", slug);
    const asPodcast = resourcePath("podcast", slug);
    await expectOk(request, asWebinar);
    await expectRedirect(request, asPodcast, asWebinar);

    await cms.setType(id, "podcast");
    await revalidate(request, [await updateEvent(id, { type: "webinar" })]);
    await expectRedirect(request, asWebinar, asPodcast);

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

/** Navigates Chromium to `from` and expects it to land on `to`, titled `title`, through at most one server-sent `no-store` redirect. */
async function expectBrowserLands(page: Page, hops: BrowserHop[], from: string, to: string, title: string): Promise<void> {
  hops.length = 0;
  const response = await page.goto(from);
  expect(new URL(page.url()).pathname, `${from} should land on ${to}`).toBe(to);
  expect(response?.status(), `${to} should answer 200`).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  const canonical = page.locator('link[rel="canonical"]');
  expect(new URL((await canonical.getAttribute("href")) as string, page.url()).pathname).toBe(to);
  expect(hops, `the redirects followed from ${from}`).toEqual(
    from === to ? [] : [{ from, status: 308, cacheControl: expect.stringContaining("no-store"), fromCache: false }],
  );
}

test("in Chromium, a type changed and changed back lands on the current URL at every step", async ({ page, request }) => {
  const slug = unique("browser-round-trip");
  const title = `Browser round trip ${RUN}`;
  const { id } = await cms.createResource({ title, type: "webinar", slug });
  const asWebinar = resourcePath("webinar", slug);
  const asPodcast = resourcePath("podcast", slug);
  const hops = await watchRedirects(page);

  await expectBrowserLands(page, hops, asWebinar, asWebinar, title);
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
