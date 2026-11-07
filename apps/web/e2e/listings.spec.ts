import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { mockCms } from "./mock-cms/client.mts";
import { E2E_REVALIDATE_SECRET, MOCK_CMS_HOST, mockCmsOrigin } from "./mock-cms/config.mts";
import { RESOURCES, TERMS } from "./mock-cms/seed.mts";
import { postRevalidate } from "./revalidation.mts";

/**
 * The listing routes under `/resources/` against the built app and the mock
 * CMS (ADRs 0024, 0025 and 0043; see `packages/ui/README.md` and
 * `docs/architecture/caching.md`): what each route lists, pagination at 12 a
 * page, the lead (the newest featured resource, on the library's first page
 * only, left out of the rows under it, with the page's one image), the
 * filter bar and the pagination as text links with 24 px targets, the 404s
 * that need data, the proxy's canonical-form 308s, the reserved segments,
 * the CMS's absence from the HTML, keyboard reach, forced colours, and a
 * revalidation event from the CMS reaching every listing it should through
 * its tags (the table in `docs/architecture/caching.md`).
 *
 * The app's Data Cache and its stored pages outlive the mock's reset, in the
 * process and on disk (e2e/README.md), so `beforeEach` resets the mock and
 * then clears every listing tag through the revalidate route
 * (`clearAppCache`), so each test starts from the seed on both sides. Checks
 * that follow a change poll, because an ISR page may serve its stored copy
 * once more while it re-renders.
 */

const PER_PAGE = 12;

const cms = mockCms();

/** A slug of this run's own, so no cached entry from an earlier run applies (e2e/README.md). */
const RUN = Date.now().toString(36);

const PUBLISHED = RESOURCES.filter((resource) => resource.status === "publish");

/** The seeded featured resources, newest first; the first is the library's lead. */
const FEATURED = PUBLISHED.filter((resource) => resource.featured);

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
  const response = await postRevalidate(request, {
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

/** The rows' titles, in order; the lead's title is not among them (`.rh-lead__title`). */
async function cardTitles(page: Page): Promise<string[]> {
  return page.locator(".rh-card__title").allTextContents();
}

async function leadTitle(page: Page): Promise<string | null> {
  const lead = page.locator(".rh-lead__title");
  return (await lead.count()) === 0 ? null : lead.textContent();
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
  test("the library, in two pages of twelve, the newest featured resource as the lead of the first", async ({ page }) => {
    const all = seededTitles();
    expect(all).toHaveLength(14);
    // The seed's newest resource is featured, so it is the lead and the rows start at the second.
    expect(texturized(FEATURED[0].title)).toBe(all[0]);
    await expectListing(page, "/resources/", "Resources", all.slice(1, PER_PAGE));
    expect(await leadTitle(page)).toBe(all[0]);
    await expect(page.getByText("14 resources")).toBeVisible();
    await expectListing(page, "/resources/page/2/", "Resources", all.slice(PER_PAGE));
    expect(await leadTitle(page)).toBeNull();
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
  test("has one h1, a titled document, a canonical link, and a list of rows under the lead", async ({ page }) => {
    await page.goto("/resources/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page).toHaveTitle("Resources | Resource Hub");
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    expect(new URL((await canonical.getAttribute("href")) as string, page.url()).pathname).toBe("/resources/");

    const grid = page.locator("ul.rh-card-grid");
    await expect(grid).toHaveAttribute("role", "list");
    // Twelve on the page, one of them the lead, so eleven rows.
    await expect(grid.locator("> li")).toHaveCount(PER_PAGE - 1);
    // Each row's title is one heading with one link, and the rows have no image.
    await expect(grid.locator("> li h3.rh-card__title")).toHaveCount(PER_PAGE - 1);
    await expect(grid.locator("> li a")).toHaveCount(PER_PAGE - 1);
    await expect(grid.locator("img")).toHaveCount(0);
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

test.describe("the lead", () => {
  test("is the newest featured resource, on the library's first page only, with the page's one image loaded first", async ({ page }) => {
    await page.goto("/resources/");
    const lead = page.locator(".rh-lead");
    await expect(lead).toHaveCount(1);
    const featured = FEATURED[0];
    await expect(lead.locator(".rh-lead__title")).toHaveText(texturized(featured.title));
    await expect(lead.getByRole("link")).toHaveCount(1);
    await expect(lead.getByRole("link")).toHaveAttribute("href", `/resources/${featured.type}/${featured.slug}/`);
    await expect(lead.locator(".rh-card__type")).toHaveText(termName("resource_type", featured.type));
    await expect(lead.locator(".rh-card__type")).toHaveAttribute("data-accent", "grape");
    // The outline: Featured and Latest as h2s, the lead's title and the rows as h3s.
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Featured", "Latest"]);
    await expect(lead.locator("h3.rh-lead__title")).toHaveCount(1);
    expect(await cardTitles(page)).not.toContain(texturized(featured.title));

    // The lead's image is the page's only image: not lazy (`preload` writes no
    // `loading`, which is eager), at high priority, preloaded from the head.
    const image = lead.locator(".rh-lead__media img");
    await expect(image).toHaveCount(1);
    expect(await image.evaluate((img) => (img as HTMLImageElement).loading)).not.toBe("lazy");
    expect(await image.evaluate((img) => (img as HTMLImageElement).fetchPriority)).toBe("high");
    await expect(image).toHaveAttribute("sizes", /100vw/);
    await expect(page.locator("img")).toHaveCount(1);
    const preloads = page.locator('link[rel="preload"][as="image"]');
    await expect(preloads).toHaveCount(1);
    await expect(preloads).toHaveAttribute("fetchpriority", "high");
    // The box is reserved at 16:9 whatever the image's own shape, so the late image moves nothing.
    await expect(lead.locator(".rh-lead__media")).toHaveCSS("aspect-ratio", "16 / 9");
  });

  test("a filtered listing and a later page have no lead, no section headings, and rows at h2", async ({ page }) => {
    for (const path of ["/resources/page/2/", `/resources/${FEATURED[0].type}/`, "/resources/topic/performance/", "/resources/article/topic/accessibility/"]) {
      await page.goto(path);
      await expect(page.locator(".rh-lead"), path).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 2, name: /Featured|Latest/ }), path).toHaveCount(0);
      await expect(page.locator("h2.rh-card__title"), path).toHaveCount((await cardTitles(page)).length);
      await expect(page.locator("img"), path).toHaveCount(0);
    }
    // The lead's own type listing still lists it, as a row.
    await page.goto(`/resources/${FEATURED[0].type}/`);
    expect(await cardTitles(page)).toContain(texturized(FEATURED[0].title));
  });

  test("a newly featured resource becomes the lead through its resource event; with nothing featured, the list stands alone", async ({
    page,
    request,
  }) => {
    // Render and store the library first, so the change below is seen through the cache.
    await page.goto("/resources/");
    expect(await leadTitle(page)).toBe(texturized(FEATURED[0].title));

    const title = `A featured webinar ${RUN}`;
    const created = await cms.createResource({ title, slug: `featured-webinar-${RUN}`, type: "webinar", featured: true });
    try {
      // Before the event the stored library keeps its lead: the mock changed, the app's cache did not.
      await page.goto("/resources/");
      expect(await leadTitle(page)).toBe(texturized(FEATURED[0].title));

      // Flagging a resource is reported as an update of that resource, never a
      // term event (flags send none), so this one resource event, and no
      // `clearAppCache`, must clear the lead's tags. The mock creates the
      // resource already flagged; the event stands for the save that flagged it.
      const { origin } = await cms.state();
      const where = { slug: created.slug, types: ["webinar"], topics: [] };
      const updated = await revalidate(request, [
        { type: "resource", event: "update", id: created.id, rest_url: `${origin}/wp-json/wp/v2/resources/${created.id}`, ...where, previous: where },
      ]);
      expect(((await updated.json()) as { revalidated: string[] }).revalidated).toContain("/resources/");
      await expect
        .poll(async () => {
          await page.goto("/resources/");
          return leadTitle(page);
        }, { message: "the lead after the update event", timeout: 10_000 })
        .toBe(title);
      expect(await cardTitles(page)).not.toContain(title);
      expect(await cardTitles(page)).toHaveLength(PER_PAGE - 1);
      await expect(page.getByText("15 resources")).toBeVisible();

      for (const id of [created.id, ...FEATURED.map((resource) => resource.id)]) {
        await cms.setStatus(id, "trash");
      }
      await clearAppCache(request);
      await page.goto("/resources/");
      await expect(page.locator(".rh-lead")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 2, name: /Featured|Latest/ })).toHaveCount(0);
      const remaining = seededTitles().filter((candidate) => !FEATURED.some((resource) => texturized(resource.title) === candidate));
      expect(await cardTitles(page)).toEqual(remaining);
      await expect(page.locator("h2.rh-card__title")).toHaveCount(remaining.length);
      await expect(page.getByText(`${remaining.length} resources`)).toBeVisible();
      await expect(page.locator("img")).toHaveCount(0);
    } finally {
      await cms.reset();
      await clearAppCache(request);
    }
  });

  test("a failed lead read leaves the library: a 200 with every row of page 1 and no lead", async ({ page, request }) => {
    // The flag's lookup is the lead's first read and no other read on the page
    // makes it, so a fault there fails the lead alone.
    await cms.addFault({ path: "/wp-json/wp/v2/resource_flag", status: 500 });
    try {
      // The library can be rendered and stored at any moment by a prefetch
      // from a page another test left open (every page's header links to it,
      // and the previous test's page is torn down as this one starts), and a
      // render in flight across `beforeEach`'s clear outlives it, so the page
      // would answer from that store without meeting the fault. Clear again
      // now that the fault is set, and read until the fault was met.
      await expect
        .poll(
          async () => {
            await clearAppCache(request);
            await cms.resetRequests();
            const response = await page.goto("/resources/");
            expect(response?.status()).toBe(200);
            const { byPath } = await cms.requests();
            return Object.keys(byPath).some((requested) => requested.startsWith("/wp-json/wp/v2/resource_flag?"));
          },
          { message: "the front end never asked for the flag, so the fault was never met", timeout: 10_000 },
        )
        .toBe(true);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resources");
      await expect(page.locator(".rh-lead")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 2, name: /Featured|Latest/ })).toHaveCount(0);
      expect(await cardTitles(page)).toEqual(seededTitles().slice(0, PER_PAGE));
      await expect(page.locator("h2.rh-card__title")).toHaveCount(PER_PAGE);
      await expect(page.getByText("14 resources")).toBeVisible();
    } finally {
      await cms.clearFaults();
      await clearAppCache(request);
    }
  });

  test("a lead whose own place is on a later page is a row there, and the pages stay the CMS's", async ({ page, request }) => {
    // Keep one featured resource, the seed's oldest, and publish enough newer
    // ones to push it onto page 2: it leads page 1 all the same, page 1 keeps
    // its twelve rows, and page 2 lists it as a row.
    const kept = FEATURED[FEATURED.length - 1];
    for (const resource of FEATURED.slice(0, -1)) {
      await cms.setStatus(resource.id, "trash");
    }
    const published = PUBLISHED.length - (FEATURED.length - 1);
    const olderThanKept = PUBLISHED.slice(PUBLISHED.indexOf(kept) + 1).length;
    // The kept one's place from the top, once the trashed ones are gone, plus the new ones.
    const keptPlace = published - olderThanKept;
    const added = PER_PAGE + 1 - keptPlace;
    expect(added).toBeGreaterThan(0);
    for (let index = 0; index < added; index++) {
      await cms.createResource({ title: `Newer than the lead ${RUN} ${index}`, slug: `newer-${RUN}-${index}`, type: "article" });
    }
    try {
      await clearAppCache(request);
      await page.goto("/resources/");
      expect(await leadTitle(page)).toBe(texturized(kept.title));
      expect(await cardTitles(page)).toHaveLength(PER_PAGE);
      expect(await cardTitles(page)).not.toContain(texturized(kept.title));
      await expect(page.getByText(`${published + added} resources`)).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Page 2" })).toHaveAttribute("href", "/resources/page/2/");

      await page.goto("/resources/page/2/");
      expect(await leadTitle(page)).toBeNull();
      expect(await cardTitles(page)).toHaveLength(published + added - PER_PAGE);
      expect((await cardTitles(page))[0]).toBe(texturized(kept.title));
      await expectNotFound(request, "/resources/page/3/");
    } finally {
      await cms.reset();
      await clearAppCache(request);
    }
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

  test("a type, a topic and a type within a topic each have a page 2, and no page 3", async ({ page, request }) => {
    // Thirteen webinars on accessibility: the seed has none, so the combination
    // alone needs a second page, and the type and the topic do too.
    const created = PER_PAGE + 1;
    for (let index = 0; index < created; index++) {
      await cms.createResource({
        title: `Paged webinar ${RUN} ${index}`,
        slug: `paged-webinar-${RUN}-${index}`,
        type: "webinar",
        topics: ["accessibility"],
      });
    }
    try {
      await clearAppCache(request);
      const listings = [
        { base: "/resources/webinar/", name: "Webinar resources", total: seededTitles({ type: "webinar" }).length + created },
        {
          base: "/resources/topic/accessibility/",
          name: "Resources on Accessibility",
          total: seededTitles({ topic: "accessibility" }).length + created,
        },
        { base: "/resources/webinar/topic/accessibility/", name: "Webinar resources on Accessibility", total: created },
      ];
      for (const { base, name, total } of listings) {
        expect(total, base).toBeGreaterThan(PER_PAGE);
        expect(total, base).toBeLessThanOrEqual(2 * PER_PAGE);
        const second = `${base}page/2/`;
        // A page stored for this path earlier (a 404 from another test, or a
        // 200 from an earlier run) may be served once more while it
        // re-renders, so wait for a card of this run's: the oldest created
        // resources are on page 2 of all three.
        await expect
          .poll(
            async () => {
              const response = await page.goto(second);
              return response?.status() === 200 && (await cardTitles(page)).some((title) => title.includes(RUN));
            },
            { message: `${second} after the change`, timeout: 10_000 },
          )
          .toBe(true);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
        await expect(page).toHaveTitle(`${name}, page 2 | Resource Hub`);
        expect(new URL((await page.locator('link[rel="canonical"]').getAttribute("href")) as string, page.url()).pathname, second).toBe(second);
        const nav = page.getByRole("navigation", { name: "Pagination" });
        await expect(nav.getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
        await expect(nav.getByRole("link", { name: "Page 1" })).not.toHaveAttribute("aria-current", "page");
        await expect(nav.getByRole("link", { name: "Previous" })).toHaveAttribute("href", base);
        expect(await cardTitles(page), second).toHaveLength(total - PER_PAGE);

        await expectNotFound(request, `${base}page/3/`);
        await expectCanonicalRedirect(request, `${base}page/1/`, base);
      }
    } finally {
      await cms.reset();
      await clearAppCache(request);
    }
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
    // An empty combination is a real page, indexable like any other.
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
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

  test("an escape of ! * ' ( ) gets one 308 to the decoded path, which the proxy then leaves alone", async ({ request }) => {
    // Next.js decodes these in params (DECODED_IN_PARAMS), so the page would see
    // the decoded path either way; the proxy sends it there in one hop, and the
    // target, sent and parsed back as written, is not redirected again.
    for (const [from, to] of [
      ["/resources/topic/it%27s/", "/resources/topic/it's/"],
      ["/resources/topic/now%21/", "/resources/topic/now!/"],
      ["/resources/topic/%28draft%29/", "/resources/topic/(draft)/"],
      ["/resources/webinar/topic/a%2ab/page/2/", "/resources/webinar/topic/a*b/page/2/"],
      ["/resources/Topic/It%27S/page/1/", "/resources/topic/it's/"],
    ]) {
      const first = await get(request, from);
      expect(first.status(), `${from} should redirect`).toBe(308);
      expect(cacheDirectives(first)).toContain("no-store");
      expect(new URL(first.headers().location as string, "http://localhost/").pathname, from).toBe(to);
      // No such topic in the seed: the route's 404, not a second redirect.
      const second = await get(request, to);
      expect(second.status(), `${to} should be the route's answer`).toBe(404);
      expect(second.headers().location, to).toBeUndefined();
    }
  });

  test("a capitalised /Resources/ prefix gets the proxy's 308 to the library, in one hop with both rules applied", async ({ request }) => {
    // The proxy covers every path since the pages catch-all became ISR (see
    // `docs/architecture/caching.md`), so the prefix is lower-cased like any
    // other segment.
    await expectCanonicalRedirect(request, "/Resources/", "/resources/");
    await expectCanonicalRedirect(request, "/RESOURCES/webinar/", "/resources/webinar/");
    await expectCanonicalRedirect(request, "/Resources/Webinar/page/1/", "/resources/webinar/");
  });

  test("a malformed escape is left as sent: no redirect, never a chain", async ({ request }) => {
    for (const path of ["/resources/x/%4%41/", "/resources/topic/a%zz/"]) {
      const response = await get(request, path);
      expect(response.status(), path).not.toBe(308);
      expect(response.headers().location, path).toBeUndefined();
    }
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

test.describe("a resource the reader schema refuses", () => {
  // WordPress keeps an escape an editor types in a slug; the front end refuses
  // it (slugProblem), so the list skips that one resource (`lib/wp/fetch.ts`).
  test("is left off its page, the other cards render, and the count and pages stay the CMS's", async ({ page, request }) => {
    const title = "A refused case study";
    await cms.createResource({ title, type: "case-study", slug: "refused%2dcase-study" });
    await clearAppCache(request);

    const all = seededTitles();
    // 15 resources newest first: page 1 holds the refused one and the eleven
    // seeded before it, page 2 the last three, as the CMS paginates them. The
    // newest seeded one is the lead, so page 1 shows ten rows.
    await expectListing(page, "/resources/", "Resources", all.slice(1, PER_PAGE - 1));
    expect(await leadTitle(page)).toBe(all[0]);
    await expect(page.getByText("15 resources")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Page 2", exact: true })).toHaveAttribute(
      "href",
      "/resources/page/2/",
    );
    expect(await page.content()).not.toContain(title);
    await expectListing(page, "/resources/page/2/", "Resources", all.slice(PER_PAGE - 1));
    await expectListing(page, "/resources/case-study/", "Case study resources", seededTitles({ type: "case-study" }));
  });

  test("a short page whose resources all fail is a 200 with the empty state, not a 404", async ({ page, request }) => {
    expect(seededTitles({ type: "webinar", topic: "accessibility" })).toEqual([]);
    for (const slug of ["refused%2done", "refused%2dtwo"]) {
      await cms.createResource({ title: `Refused ${slug}`, type: "webinar", topics: ["accessibility"], slug });
    }
    await clearAppCache(request);

    const response = await page.goto("/resources/webinar/topic/accessibility/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Webinar resources on Accessibility");
    await expect(page.locator(".rh-card")).toHaveCount(0);
    // The count is the CMS's, and the empty state does not contradict it.
    await expect(page.getByText("2 resources")).toBeVisible();
    await expect(page.getByText("The resources on this page can't be shown.")).toBeVisible();
    // The 200 is stored for up to an hour, so it is kept out of the index.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("link", { name: "Show all resources" })).toHaveAttribute("href", "/resources/");
    await expect(page.getByRole("navigation", { name: "Pagination" })).toHaveCount(0);
  });
});

test.describe("in forced-colours mode", () => {
  test.use({ forcedColors: "active" });

  /** The styles that can still tell a link apart once forced colours drop its background. */
  async function marks(locator: ReturnType<Page["locator"]>) {
    return locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
        underline: `${style.textDecorationLine} ${style.textDecorationThickness}`,
      };
    });
  }

  test("the current filter and the current page are marked by an outline and a heavier underline, not weight alone", async ({ page }) => {
    await page.goto("/resources/article/");
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
    const types = page.getByRole("navigation", { name: "Filter resources" }).getByRole("list", { name: "Type" });
    const current = await marks(types.getByRole("link", { name: "Article" }));
    const neighbour = await marks(types.getByRole("link", { name: "Webinar" }));
    expect(current.outline).not.toEqual(neighbour.outline);
    expect(current.underline).not.toEqual(neighbour.underline);
    expect(current.outline).toMatch(/^solid /);
    expect(current.underline).toMatch(/^underline /);
    expect(neighbour.outline).toMatch(/^none /);

    await page.goto("/resources/page/2/");
    const nav = page.getByRole("navigation", { name: "Pagination" });
    const currentPage = await marks(nav.getByRole("link", { name: "Page 2" }));
    const otherPage = await marks(nav.getByRole("link", { name: "Page 1" }));
    expect(currentPage.outline).not.toEqual(otherPage.outline);
    expect(currentPage.underline).not.toEqual(otherPage.underline);
    expect(currentPage.outline).toMatch(/^solid /);
    expect(currentPage.underline).toMatch(/^underline /);
    expect(otherPage.outline).toMatch(/^none /);
  });

  test("every type mark takes the text colour, beside its printed name", async ({ page }) => {
    await page.goto("/resources/");
    // Every dot, whatever its accent, is the colour the text beside it is drawn in.
    const marks = await page.locator(".rh-card__type").evaluateAll((nodes) =>
      nodes.map((node) => ({
        accent: node.getAttribute("data-accent"),
        dot: getComputedStyle(node, "::before").backgroundColor,
        text: getComputedStyle(node).color,
      })),
    );
    expect(marks.length).toBeGreaterThan(0);
    expect(new Set(marks.map((mark) => mark.accent)).size).toBeGreaterThan(1);
    for (const mark of marks) {
      expect(mark.dot, mark.accent ?? "none").toBe(mark.text);
    }
  });
});

test.describe("targets and reflow at 320 px", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("every filter and pagination link is at least 24 px tall and wide, and nothing scrolls sideways", async ({ page }) => {
    await page.goto("/resources/");
    for (const name of ["Filter resources", "Pagination"]) {
      const links = page.getByRole("navigation", { name }).getByRole("link");
      expect(await links.count(), name).toBeGreaterThan(0);
      for (const link of await links.all()) {
        const box = await link.boundingBox();
        expect(box, name).not.toBeNull();
        expect(box?.height, `${name}: ${await link.textContent()}`).toBeGreaterThanOrEqual(24);
        expect(box?.width, `${name}: ${await link.textContent()}`).toBeGreaterThanOrEqual(24);
      }
    }
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    // The lead stacks: its body under its image, each the content's width.
    const media = await page.locator(".rh-lead__media").boundingBox();
    const body = await page.locator(".rh-lead__body").boundingBox();
    if (!media || !body) throw new Error("the lead has no boxes");
    expect(body.y).toBeGreaterThan(media.y + media.height - 1);
    expect(Math.abs(body.width - media.width)).toBeLessThan(2);
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

  // Skip link, the header's name, then straight into the filters.
  await page.keyboard.press("Tab");
  expect((await focused())?.text).toBe("Skip to content");
  await page.keyboard.press("Tab");
  expect((await focused())?.text).toBe("Resource Hub");
  await page.keyboard.press("Tab");
  expect(await focused()).toEqual({ text: "All types", nav: "Filter resources" });

  // Every filter link in turn, then the lead, then the rows, then the pagination, with nothing in between.
  const filterLinks = await page.getByRole("navigation", { name: "Filter resources" }).getByRole("link").count();
  for (let index = 1; index < filterLinks; index++) {
    await page.keyboard.press("Tab");
    expect((await focused())?.nav).toBe("Filter resources");
  }
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.classList.contains("rh-lead__link"))).toBe(true);
  for (let index = 0; index < PER_PAGE - 1; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.classList.contains("rh-card__link"))).toBe(true);
  }
  await page.keyboard.press("Tab");
  expect(await focused()).toEqual({ text: "1", nav: "Pagination" });
  await page.keyboard.press("Tab");
  expect(await focused()).toEqual({ text: "2", nav: "Pagination" });
  await page.keyboard.press("Tab");
  expect(await focused()).toEqual({ text: "Next", nav: "Pagination" });
  // Past the page's content, the footer: the publisher's link, then the
  // theme control, the last stop (one stop: its checked radio, `theme.spec.ts`).
  await page.keyboard.press("Tab");
  expect(await focused()).toEqual({ text: "Colbination", nav: null });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("contentinfo").getByRole("radio", { name: "System theme", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  expect(await focused()).toEqual({ text: "Next", nav: "Pagination" });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/resources\/page\/2\/$/);
  // The client navigation puts focus on the new page's heading, not back on <body>.
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});

test.describe("focus after a client navigation", () => {
  test("a full page load leaves focus alone; a filter or page link moves it to the listing's h1", async ({ page }) => {
    await page.goto("/resources/");
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    const heading = page.getByRole("heading", { level: 1 });
    const types = page.getByRole("navigation", { name: "Filter resources" }).getByRole("list", { name: "Type" });
    await types.getByRole("link", { name: "Article" }).click();
    await expect(page).toHaveURL(/\/resources\/article\/$/);
    await expect(heading).toHaveText("Article resources");
    await expect(heading).toBeFocused();
    await expect(heading).toHaveAttribute("tabindex", "-1");

    // Within one route, too: another type is the same `[type]` page with another param.
    await types.getByRole("link", { name: "Webinar" }).click();
    await expect(heading).toHaveText("Webinar resources");
    await expect(heading).toBeFocused();

    // And the next Tab goes on from the heading into the filters.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("All types");
  });
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
