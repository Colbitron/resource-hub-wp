import { expect, test, type APIRequestContext } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { E2E_REVALIDATE_SECRET, mockCmsOrigin } from "./mock-cms/config.mts";

/**
 * The data layer against the mock CMS, through the fixture page at
 * /fixtures/data-layer/ (app/fixtures/data-layer/page.fixture.tsx): two
 * pages of the library and one resource by slug, rendered with ResourceCard.
 * The page renders on every request, so the request counters show the
 * Data Cache at work.
 *
 * The last test publishes a resource the reader schema refuses and clears
 * the Data Cache through the revalidate route, then puts the seed back and
 * clears it again, so no later test or run is served the changed listing.
 */

const FIXTURE_PATH = "/fixtures/data-layer/";
const SEEDED_SLUG = "revalidation-from-the-editors-chair";

const cms = mockCms();

/** Requests to the mock's REST API, by path and query, from its counters. */
async function restRequests(): Promise<Record<string, number>> {
  const { byPath } = await cms.requests();
  return Object.fromEntries(Object.entries(byPath).filter(([path]) => path.startsWith("/wp-json/")));
}

test.beforeEach(async () => {
  await cms.reset();
});

test("renders two pages of the library and a resource by slug through ResourceCard", async ({ page }) => {
  // The image optimizer is not under test here; the cards hold their shape without it.
  await page.route("**/_next/image**", (route) => route.abort());
  await page.goto(FIXTURE_PATH);

  await expect(page.getByRole("heading", { level: 1, name: "Data layer fixtures" })).toBeVisible();

  // The seed has 14 published resources, 12 to a page.
  const first = page.getByTestId("page-1");
  await expect(first.getByTestId("page-1-totals")).toHaveText("14 resources on 2 pages");
  await expect(first.locator(".rh-card")).toHaveCount(12);
  const second = page.getByTestId("page-2");
  await expect(second.locator(".rh-card")).toHaveCount(2);

  // Newest first: the seed's first row leads page 1, its last two make up page 2.
  await expect(first.locator(".rh-card__link").first()).toHaveAttribute(
    "href",
    "/resources/ebook/a-field-guide-to-revalidation/",
  );
  await expect(second.locator(".rh-card__link")).toHaveText([
    "An accessibility audit in a day",
    "Revalidation from the editor’s chair",
  ]);

  const single = page.getByTestId("by-slug");
  const link = single.locator(".rh-card__link");
  await expect(link).toHaveText("Revalidation from the editor’s chair");
  await expect(link).toHaveAttribute("href", `/resources/webinar/${SEEDED_SLUG}/`);
  await expect(single.locator(".rh-card__type")).toHaveText("Webinar");
  await expect(single.locator(".rh-card__topic")).toHaveText(["Editorial workflow", "Headless delivery"]);
  await expect(single.locator(".rh-card__media img")).toHaveCount(1);

  // Page 1 has two resources with no image and one whose SVG has no dimensions: nine media boxes.
  await expect(first.locator(".rh-card__media")).toHaveCount(9);
});

test("the HTML names neither the mock's origin nor wp-content", async ({ request }) => {
  const response = await request.get(FIXTURE_PATH);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("rh-card");
  expect(html).toContain("/media/");
  expect(html).not.toContain(mockCmsOrigin());
  expect(html).not.toContain("127.0.0.1");
  expect(html).not.toContain("wp-content");
  expect(html).not.toContain("wp-json");
});

test("one fetcher called twice in a render makes one request on a cold cache", async ({ request }) => {
  // No such resource: the mock answers core's 404, which the Data Cache never
  // keeps, so the cache is cold on every load and only the per-render
  // memoization (React's cache in lib/wp/fetch.ts) can make the two reads one.
  const missingId = 999_999;
  const response = await request.get(`${FIXTURE_PATH}?twice=${missingId}`);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("miss, miss");
  const requests = await restRequests();
  expect(requests[`/wp-json/wp/v2/resources/${missingId}?_embed`]).toBe(1);
});

test("a second load is served from the Data Cache, with no new request to the CMS", async ({ request }) => {
  // Warm the cache. Next.js may finish writing an entry after the response
  // that fetched it has gone, so load twice before counting.
  for (let load = 0; load < 2; load++) {
    expect((await request.get(FIXTURE_PATH)).status()).toBe(200);
  }

  // Change what the CMS would answer, so a fetch that reached it would show.
  await cms.createResource({ title: "Published after the cache was warm", type: "article" });
  await cms.resetRequests();

  const response = await request.get(FIXTURE_PATH);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("14 resources on 2 pages");
  expect(html).not.toContain("Published after the cache was warm");
  expect(await restRequests()).toEqual({});
});

/** Clears every listing in the Data Cache, as any event from the CMS does (ADR 0046), with an `update` for a seed resource. */
async function clearListings(request: APIRequestContext): Promise<void> {
  const { origin, resources } = await cms.state();
  const seeded = resources.find((resource) => resource.slug === SEEDED_SLUG);
  if (seeded === undefined || seeded.type === null) throw new Error("the seed has no typed resource to send an event for");
  const state = { slug: seeded.slug, types: [seeded.type], topics: seeded.topics };
  const response = await request.post("/api/revalidate/", {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
    data: JSON.stringify({
      version: 1,
      events: [
        {
          type: "resource",
          event: "update",
          id: seeded.id,
          rest_url: `${origin}/wp-json/wp/v2/resources/${seeded.id}`,
          ...state,
          previous: state,
        },
      ],
    }),
  });
  expect(response.status(), await response.text()).toBe(200);
}

test("a resource the reader schema refuses leaves the listing, the other resources still render", async ({
  page,
  request,
}) => {
  // WordPress keeps an escape an editor types in a slug; the front end refuses
  // it (slugProblem), so the list skips this one resource rather than failing.
  const escapedSlug = "case%2dstudy";
  const title = "A case study with an escaped slug";
  await cms.createResource({ title, type: "article", slug: escapedSlug });
  expect((await cms.state()).resources.find((resource) => resource.title === title)?.slug).toBe(escapedSlug);

  try {
    await clearListings(request);
    const response = await request.get(FIXTURE_PATH);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toContain(title);
    expect(html).not.toContain(escapedSlug);

    await page.route("**/_next/image**", (route) => route.abort());
    await page.goto(FIXTURE_PATH);
    // The CMS's totals are kept: it counts 15 now, newest first, so page 1
    // holds the new resource, skipped, and the eleven before it.
    const first = page.getByTestId("page-1");
    await expect(first.getByTestId("page-1-totals")).toHaveText("15 resources on 2 pages");
    await expect(first.locator(".rh-card")).toHaveCount(11);
    await expect(first.locator(".rh-card__link").first()).toHaveAttribute(
      "href",
      "/resources/ebook/a-field-guide-to-revalidation/",
    );
    await expect(page.getByTestId("page-2").locator(".rh-card")).toHaveCount(3);
    await expect(page.getByTestId("by-slug").locator(".rh-card__link")).toHaveAttribute(
      "href",
      `/resources/webinar/${SEEDED_SLUG}/`,
    );

    // Its own URL reaches the page decoded, as another slug that names nothing: a 404.
    const own = await request.get(`/fixtures/redirect/article/${escapedSlug}/`, { maxRedirects: 0 });
    expect(own.status()).toBe(404);
  } finally {
    await cms.reset();
    await clearListings(request);
  }
});
