import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { mockCms } from "./mock-cms/client.mts";
import { E2E_REVALIDATE_SECRET, MOCK_CMS_HOST, mockCmsOrigin } from "./mock-cms/config.mts";
import { RESOURCES, TERMS } from "./mock-cms/seed.mts";

/**
 * The listing routes under `/resources/` against the built app and the mock
 * CMS (root `CLAUDE.md`, "Public URLs"; ADRs 0034, 0035 and 0050): what each
 * route lists, pagination at 12 a page, the filter bar, the 404s that need
 * data, the proxy's canonical-form 308s, the reserved segments, the CMS's
 * absence from the HTML, keyboard reach, and a revalidation event from the
 * CMS reaching every listing it should through the tags of ADR 0046.
 *
 * The app's Data Cache and its stored pages outlive the mock's reset, in the
 * process and on disk (e2e/README.md), so `beforeEach` resets the mock and
 * then clears every listing tag through the revalidate route
 * (`clearAppCache`), so each test starts from the seed on both sides. Checks
 * that follow a change poll, because an ISR page may serve its stored copy
 * once more while it re-renders.
 */

const ROUTE = "/api/revalidate/";
const PER_PAGE = 12;

const cms = mockCms();

/** A slug of this run's own, so no cached entry from an earlier run applies (e2e/README.md). */
const RUN = Date.now().toString(36);

const PUBLISHED = RESOURCES.filter((resource) => resource.status === "publish");

/** A title as WordPress renders it: `the_title` texturizes an apostrophe to a right single quote. */
function texturized(title: string): string {
  return title.replace(/'/g, "\u2019");
}

/** Titles of the seeded resources matching `filter`, newest first, as the seed is ordered and the CMS renders them. */
function seededTitles(filter: { type?: string; topic?: string } = {}): string[] {
  return PUBLISHED.filter(
    (resource) =>
      (filter.type === undefined || resource.type === filter.type) &&
      (filter.topic === undefined || resource.topics.includes(filter.topic)),
  ).map((resource) => texturized(resource.title));
}

function termName(taxonomy: "resource_type" | "resource_topic", slug: string): string {
  const term = TERMS.find((candidate) => candidate.taxonomy === taxonomy && candidate.slug === slug);
  if (term === undefined) throw new Error(`no seeded ${taxonomy} ${slug}`);
  return term.name;
}

async function revalidate(request: APIRequestContext, events: unknown[]): Promise<APIResponse> {
  const response = await request.post(ROUTE, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
    data: JSON.stringify({ version: 1, events }),
  });
  expect(response.status(), await response.text()).toBe(200);
  return response;
}

test.beforeEach(async ({ request }) => {
  await cms.reset();
  await clearAppCache(request);
});

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

async function cardTitles(page: Page): Promise<string[]> {
  return page.locator(".rh-card__title").allTextContents();
}

async function expectListing(page: Page, path: string, heading: string, titles: string[]): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  expect(await cardTitles(page), path).toEqual(titles);
}

async function expectNotFound(request: APIRequestContext, path: string): Promise<void> {
  const response = await get(request, path);
  expect(response.status(), `${path} should be a 404`).toBe(404);
  expect(response.headers().location).toBeUndefined();
}

/** One 308 from `from` to `to`, with `no-store`, not from any route cache, and `to` a 200: a single hop. */
async function expectCanonicalRedirect(request: APIRequestContext, from: string, to: string): Promise<void> {
  const first = await get(request, from);
  expect(first.status(), `${from} should redirect`).toBe(308);
  const location = first.headers().location;
  expect(location, from).toBeDefined();
  expect(new URL(location as string, "http://localhost/").pathname + new URL(location as string, "http://localhost/").search).toBe(to);
  expect(cacheDirectives(first)).toContain("no-store");
  expect(cacheDirectives(first).some((directive) => directive.startsWith("s-maxage"))).toBe(false);
  expect(first.headers()["x-nextjs-cache"]).toBeUndefined();
  const second = await get(request, to.split("?")[0]);
  expect(second.status(), `${to} should answer 200`).toBe(200);
  expect(second.headers().location).toBeUndefined();
}

test.describe("each route lists the right resources, newest first", () => {
  test("the library, in two pages of twelve", async ({ page }) => {
    const all = seededTitles();
    expect(all).toHaveLength(14);
    await expectListing(page, "/resources/", "Resources", all.slice(0, PER_PAGE));
    await expect(page.getByText("14 resources")).toBeVisible();
    await expectListing(page, "/resources/page/2/", "Resources", all.slice(PER_PAGE));
  });

  test("one type", async ({ page }) => {
    await expectListing(page, "/resources/webinar/", "Webinar resources", seededTitles({ type: "webinar" }));
    await expectListing(page, "/resources/case-study/", "Case study resources", seededTitles({ type: "case-study" }));
  });

  test("one topic", async ({ page }) => {
    await expectListing(
      page,
      "/resources/topic/accessibility/",
      "Resources on Accessibility",
      seededTitles({ topic: "accessibility" }),
    );
  });

  test("one type within one topic", async ({ page }) => {
    await expectListing(
      page,
      "/resources/article/topic/accessibility/",
      "Article resources on Accessibility",
      seededTitles({ type: "article", topic: "accessibility" }),
    );
  });

  test("every seeded type and topic lists what the seed says", async ({ page }) => {
    for (const term of TERMS) {
      if (term.taxonomy === "resource_type") {
        await expectListing(page, `/resources/${term.slug}/`, `${term.name} resources`, seededTitles({ type: term.slug }));
      } else if (term.taxonomy === "resource_topic") {
        await expectListing(page, `/resources/topic/${term.slug}/`, `Resources on ${term.name}`, seededTitles({ topic: term.slug }));
      }
    }
  });
});

test.describe("the page", () => {
  test("has one h1, a titled document, a canonical link, and a list of cards with the first row prioritised", async ({ page }) => {
    await page.goto("/resources/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page).toHaveTitle("Resources | Resource Hub");
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    expect(new URL((await canonical.getAttribute("href")) as string, page.url()).pathname).toBe("/resources/");

    const grid = page.locator("ul.rh-card-grid");
    await expect(grid).toHaveAttribute("role", "list");
    await expect(grid.locator("> li")).toHaveCount(PER_PAGE);

    const images = page.locator(".rh-card__media img");
    const loading = await images.evaluateAll((nodes) => nodes.map((img) => (img as HTMLImageElement).loading));
    const priorities = await images.evaluateAll((nodes) => nodes.map((img) => (img as HTMLImageElement).fetchPriority));
    // The first three cards are the first row at desktop width; two of the seed's first three have an image.
    const withImage = PUBLISHED.slice(0, PER_PAGE).map((resource) => resource.mediaId !== null);
    const firstRowImages = withImage.slice(0, 3).filter(Boolean).length;
    expect(loading.slice(0, firstRowImages).every((value) => value === "eager")).toBe(true);
    expect(priorities.slice(0, firstRowImages).every((value) => value === "high")).toBe(true);
    expect(loading.slice(firstRowImages).every((value) => value === "lazy")).toBe(true);
  });

  test("a filtered page's title and canonical name the filter and the page", async ({ page }) => {
    await page.goto("/resources/topic/performance/");
    await expect(page).toHaveTitle("Resources on Performance | Resource Hub");
    expect(new URL((await page.locator('link[rel="canonical"]').getAttribute("href")) as string, page.url()).pathname).toBe(
      "/resources/topic/performance/",
    );
    await page.goto("/resources/page/2/");
    await expect(page).toHaveTitle("Resources, page 2 | Resource Hub");
    expect(new URL((await page.locator('link[rel="canonical"]').getAttribute("href")) as string, page.url()).pathname).toBe(
      "/resources/page/2/",
    );
  });

  test("is stored by ISR: the second request is a route-cache hit", async ({ request }) => {
    const path = `/resources/topic/${"headless-delivery"}/`;
    const first = await get(request, path);
    expect(first.status()).toBe(200);
    const second = await get(request, path);
    expect(second.status()).toBe(200);
    expect(second.headers()["x-nextjs-cache"]).toBe("HIT");
    expect(cacheDirectives(second).some((directive) => directive.startsWith("s-maxage=3600"))).toBe(true);
  });
});

test.describe("pagination", () => {
  test("links the two pages of the library with the current one marked", async ({ page }) => {
    await page.goto("/resources/");
    const nav = page.getByRole("navigation", { name: "Pagination" });
    await expect(nav.getByRole("link", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Page 2" })).toHaveAttribute("href", "/resources/page/2/");
    await expect(nav.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/resources/page/2/");
    await expect(nav.getByRole("link", { name: "Previous" })).toHaveCount(0);

    await nav.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/resources\/page\/2\/$/);
    await expect(nav.getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/resources/");
    await expect(nav.getByRole("link", { name: "Next" })).toHaveCount(0);
    expect(await cardTitles(page)).toHaveLength(14 - PER_PAGE);
  });

  test("is left out of a listing with one page", async ({ page }) => {
    await page.goto("/resources/webinar/");
    await expect(page.getByRole("navigation", { name: "Pagination" })).toHaveCount(0);
  });

  test("a page past the end, page 0, a padded, negative or fractional page is a 404", async ({ request }) => {
    for (const path of [
      "/resources/page/3/",
      "/resources/webinar/page/2/",
      "/resources/topic/accessibility/page/2/",
      "/resources/article/topic/accessibility/page/2/",
      "/resources/page/0/",
      "/resources/page/01/",
      "/resources/page/-1/",
      "/resources/page/1x/",
      "/resources/page/x/",
      // Next.js reads a dot in the last segment as a file name and sends `/page/1.5/` to `/page/1.5` first.
      "/resources/page/1.5",
    ]) {
      await expectNotFound(request, path);
    }
  });
});

test.describe("filters", () => {
  test("offer every type and topic, keep the other dimension, and mark the current one", async ({ page }) => {
    await page.goto("/resources/");
    const filters = page.getByRole("navigation", { name: "Filter resources" });
    const types = filters.getByRole("list", { name: "Type" });
    const topics = filters.getByRole("list", { name: "Topic" });
    await expect(types.getByRole("link")).toHaveCount(1 + TERMS.filter((term) => term.taxonomy === "resource_type").length);
    await expect(topics.getByRole("link")).toHaveCount(1 + TERMS.filter((term) => term.taxonomy === "resource_topic").length);
    await expect(types.getByRole("link", { name: "All types" })).toHaveAttribute("aria-current", "true");
    await expect(topics.getByRole("link", { name: "All topics" })).toHaveAttribute("aria-current", "true");

    await types.getByRole("link", { name: termName("resource_type", "article") }).click();
    await expect(page).toHaveURL(/\/resources\/article\/$/);
    await expect(types.getByRole("link", { name: "Article" })).toHaveAttribute("aria-current", "true");
    await expect(types.getByRole("link", { name: "All types" })).not.toHaveAttribute("aria-current", "true");
    expect(await cardTitles(page)).toEqual(seededTitles({ type: "article" }));

    // A topic link keeps the type.
    await expect(topics.getByRole("link", { name: "Accessibility" })).toHaveAttribute("href", "/resources/article/topic/accessibility/");
    await topics.getByRole("link", { name: "Accessibility" }).click();
    await expect(page).toHaveURL(/\/resources\/article\/topic\/accessibility\/$/);
    await expect(types.getByRole("link", { name: "Article" })).toHaveAttribute("aria-current", "true");
    await expect(topics.getByRole("link", { name: "Accessibility" })).toHaveAttribute("aria-current", "true");
    expect(await cardTitles(page)).toEqual(seededTitles({ type: "article", topic: "accessibility" }));

    // And a type link keeps the topic; "All types" drops only the type.
    await expect(types.getByRole("link", { name: "Webinar" })).toHaveAttribute("href", "/resources/webinar/topic/accessibility/");
    await expect(types.getByRole("link", { name: "All types" })).toHaveAttribute("href", "/resources/topic/accessibility/");
    await types.getByRole("link", { name: "All types" }).click();
    await expect(page).toHaveURL(/\/resources\/topic\/accessibility\/$/);
    expect(await cardTitles(page)).toEqual(seededTitles({ topic: "accessibility" }));
  });

  test("a combination with nothing in it is a 200 with the empty state", async ({ page }) => {
    expect(seededTitles({ type: "webinar", topic: "accessibility" })).toEqual([]);
    const response = await page.goto("/resources/webinar/topic/accessibility/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Webinar resources on Accessibility");
    await expect(page.getByText("No resources match this type and topic yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Show all resources" })).toHaveAttribute("href", "/resources/");
    await expect(page.locator(".rh-card")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Pagination" })).toHaveCount(0);
  });

  test("an unknown type or topic is a 404", async ({ request }) => {
    for (const path of [
      "/resources/nope/",
      "/resources/topic/nope/",
      "/resources/webinar/topic/nope/",
      "/resources/nope/topic/accessibility/",
      "/resources/nope/page/2/",
      "/resources/topic/nope/page/2/",
    ]) {
      await expectNotFound(request, path);
    }
  });
});

test.describe("non-canonical URLs", () => {
  test("mixed case and /page/1/ get one 308 with no-store to the canonical URL", async ({ request }) => {
    await expectCanonicalRedirect(request, "/resources/Webinar/", "/resources/webinar/");
    await expectCanonicalRedirect(request, "/resources/topic/Accessibility/", "/resources/topic/accessibility/");
    await expectCanonicalRedirect(request, "/resources/Article/Topic/Accessibility/", "/resources/article/topic/accessibility/");
    await expectCanonicalRedirect(request, "/resources/page/1/", "/resources/");
    await expectCanonicalRedirect(request, "/resources/webinar/page/1/", "/resources/webinar/");
    await expectCanonicalRedirect(request, "/resources/topic/accessibility/page/1/", "/resources/topic/accessibility/");
    await expectCanonicalRedirect(request, "/resources/Webinar/Page/1/", "/resources/webinar/");
    await expectCanonicalRedirect(request, "/resources/Page/2/", "/resources/page/2/");
    await expectCanonicalRedirect(request, "/resources/%57ebinar/", "/resources/webinar/");
    await expectCanonicalRedirect(request, "/resources/Webinar/?utm=x", "/resources/webinar/?utm=x");
  });

  test("a browser following the redirect lands on the canonical page once", async ({ page }) => {
    const hops: number[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "document") hops.push(response.status());
    });
    await page.goto("/resources/Webinar/Page/1/");
    await expect(page).toHaveURL(/\/resources\/webinar\/$/);
    expect(hops).toEqual([308, 200]);
    expect(await cardTitles(page)).toEqual(seededTitles({ type: "webinar" }));
  });

  test("the reserved words are not types: /resources/page/ and /resources/topic/ are 404s", async ({ request }) => {
    await expectNotFound(request, "/resources/page/");
    await expectNotFound(request, "/resources/topic/");
    // The static `topic` segment wins over `[type]`: a topic listing, not a type called `topic`.
    const response = await get(request, "/resources/topic/accessibility/");
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Resources on Accessibility");
    // And `page` under the library is pagination, not a type.
    expect((await get(request, "/resources/page/2/")).status()).toBe(200);
  });
});

test("the HTML never names the CMS", async ({ request }) => {
  for (const path of ["/resources/", "/resources/page/2/", "/resources/webinar/", "/resources/article/topic/accessibility/", "/resources/nope/"]) {
    const html = await (await get(request, path)).text();
    expect(html, path).not.toContain(mockCmsOrigin());
    expect(html, path).not.toContain(`${MOCK_CMS_HOST}:`);
    expect(html, path).not.toContain("wp-content");
    expect(html, path).not.toContain("wp-json");
  }
});

test("the keyboard reaches the filters and the pagination in order", async ({ page }) => {
  await page.goto("/resources/");
  const focused = () =>
    page.evaluate(() => {
      const element = document.activeElement;
      return element === null || element === document.body ? null : { text: element.textContent?.trim() ?? "", nav: element.closest("nav")?.getAttribute("aria-label") ?? null };
    });

  // Skip link, then the header's name, then straight into the filters.
  await page.keyboard.press("Tab");
  expect((await focused())?.text).toBe("Skip to content");
  await page.keyboard.press("Tab");
  expect((await focused())?.text).toBe("Resource Hub");
  await page.keyboard.press("Tab");
  expect(await focused()).toEqual({ text: "All types", nav: "Filter resources" });

  // Every filter link in turn, then the cards, then the pagination, with nothing in between.
  const filterLinks = await page.getByRole("navigation", { name: "Filter resources" }).getByRole("link").count();
  for (let index = 1; index < filterLinks; index++) {
    await page.keyboard.press("Tab");
    expect((await focused())?.nav).toBe("Filter resources");
  }
  for (let index = 0; index < PER_PAGE; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.classList.contains("rh-card__link"))).toBe(true);
  }
  await page.keyboard.press("Tab");
  expect(await focused()).toEqual({ text: "1", nav: "Pagination" });
  await page.keyboard.press("Tab");
  expect(await focused()).toEqual({ text: "2", nav: "Pagination" });
  await page.keyboard.press("Tab");
  expect(await focused()).toEqual({ text: "Next", nav: "Pagination" });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/resources\/page\/2\/$/);
});

test.describe("a revalidation event from the CMS", () => {
  test("adding a resource reaches the library, its type, its topic and the type-within-topic listing; trashing it takes it off them", async ({
    page,
    request,
  }) => {
    const title = `A fresh webinar on accessibility ${RUN}`;
    const paths = ["/resources/", "/resources/webinar/", "/resources/topic/accessibility/", "/resources/webinar/topic/accessibility/"];
    // Render and store every listing first, so the change below is seen through the cache.
    for (const path of paths) {
      await page.goto(path);
      expect(await cardTitles(page), `${path} before the change`).not.toContain(title);
    }

    const created = await cms.createResource({ title, slug: `fresh-webinar-${RUN}`, type: "webinar", topics: ["accessibility"] });
    const { origin } = await cms.state();
    const state = { id: created.id, slug: created.slug, rest_url: `${origin}/wp-json/wp/v2/resources/${created.id}`, types: ["webinar"], topics: ["accessibility"] };

    // Before the event, every listing still serves the seed: the mock changed, the app's stored pages did not.
    for (const path of paths) {
      await page.goto(path);
      expect(await cardTitles(page), `${path} before the event`).not.toContain(title);
    }

    const published = await revalidate(request, [{ type: "resource", event: "publish", ...state, previous: null }]);
    const { revalidated } = (await published.json()) as { revalidated: string[] };
    expect(revalidated).toEqual(expect.arrayContaining(paths));

    for (const path of paths) {
      await expect
        .poll(async () => {
          await page.goto(path);
          return cardTitles(page);
        }, { message: `${path} after publish`, timeout: 10_000 })
        .toContain(title);
    }
    // The newest resource leads the library, and the page count held: 15 resources are still 2 pages.
    await page.goto("/resources/");
    expect((await cardTitles(page))[0]).toBe(title);
    await expect(page.getByText("15 resources")).toBeVisible();

    await cms.setStatus(created.id, "trash");
    await revalidate(request, [{ type: "resource", event: "trash", ...state, previous: null }]);
    for (const path of paths) {
      await expect
        .poll(async () => {
          await page.goto(path);
          return cardTitles(page);
        }, { message: `${path} after trash`, timeout: 10_000 })
        .not.toContain(title);
    }
    await page.goto("/resources/webinar/topic/accessibility/");
    await expect(page.getByText("No resources match this type and topic yet.")).toBeVisible();
  });
});
