import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { mockCms } from "./mock-cms/client.mts";
import { E2E_REVALIDATE_SECRET, MOCK_CMS_HOST, mockCmsPort } from "./mock-cms/config.mts";
import { RESOURCES } from "./mock-cms/seed.mts";
import { postRevalidate } from "./revalidation.mts";

/**
 * The resource page's related section (`components/RelatedSection.tsx`,
 * issue #50) against the built app and the mock CMS, whose related route
 * merges as the contract says (`packages/ui/README.md`, "Related items"):
 * the picks first in the editor's order, an unpublished pick skipped, then
 * the newest resources sharing a topic; the rows as the listing's rows under
 * a heading that names the section; no section for a resource with nothing
 * related; the page rendered without the section, a 200 with nothing of the
 * CMS in it, when the related route fails or the CMS has no such route
 * (core's 404 `rest_no_route`), and with the section again once
 * the failure has passed and the resource's event has cleared the page; and
 * an unpublished pick leaving the section after its event, through the
 * `resources` tag the section's reads carry.
 *
 * Changes to the mock are followed by the revalidation event the CMS would
 * send, because the app's Data Cache does not see the mock change
 * (e2e/README.md); resources a test creates get a slug of this run's own.
 */

/** The seeded webinar (ID 33) with picks: a draft (34), a cross-topic pick (29) and one that also shares a topic (21). */
const HOST = { id: 33, type: "webinar", slug: "revalidation-from-the-editors-chair" };

const cms = mockCms();

const RUN = Date.now().toString(36);

function unique(slug: string): string {
  return `${slug}-${RUN}`;
}

function resourcePath(type: string, slug: string): string {
  return `/resources/${type}/${slug}/`;
}

function seeded(id: number) {
  const resource = RESOURCES.find((candidate) => candidate.id === id);
  if (resource === undefined) throw new Error(`the seed has no resource ${id}`);
  return resource;
}

/** A schema-valid resource event for `id` in the mock's current state, with `previous` null, as a publish or an unpublish carries it. */
async function resourceEvent(event: "publish" | "unpublish", id: number) {
  const { origin, resources } = await cms.state();
  const resource = resources.find((candidate) => candidate.id === id);
  if (resource === undefined || resource.type === null) throw new Error(`the mock has no typed resource ${id}`);
  return {
    type: "resource",
    event,
    id,
    slug: resource.slug,
    rest_url: `${origin}/wp-json/wp/v2/resources/${id}`,
    types: [resource.type],
    topics: resource.topics,
    previous: null,
  };
}

async function revalidate(request: APIRequestContext, events: unknown[]): Promise<void> {
  const response = await postRevalidate(request, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
    data: JSON.stringify({ version: 1, events }),
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** The section as a reader finds it: the region the heading names. */
function section(page: Page) {
  return page.getByRole("region", { name: "Related resources" });
}

function rowTitles(page: Page): Promise<string[]> {
  return section(page).locator(".rh-card__title").allTextContents();
}

test.beforeEach(async () => {
  await cms.reset();
});

test.afterEach(async ({ request }) => {
  // A fault must never outlive its test, and the seeded host's page must be
  // rendered again from the reset seed by whichever spec reads it next: the
  // term events clear `resources` and `terms`, which the section's reads
  // carry (e2e/README.md).
  await cms.clearFaults();
  await clearAppCache(request);
});

test.describe("what the section renders", () => {
  test("the picks first, in the editor's order, then the newest in a shared topic, with the unpublished pick skipped", async ({ page }) => {
    await page.goto(resourcePath(HOST.type, HOST.slug));
    await expect(section(page)).toBeVisible();
    // Picks 29 and 21 in the editor's order (the draft, 34, is skipped), then
    // the newest published resource sharing one of the host's topics, 20.
    expect(await rowTitles(page)).toEqual([
      seeded(29).title,
      seeded(21).title,
      seeded(20).title,
    ]);
    await expect(page.getByText(seeded(34).title)).toHaveCount(0);
    // Each row links to its resource at its own path.
    const hrefs = await section(page).locator(".rh-card__link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(hrefs).toEqual([resourcePath("case-study", seeded(29).slug), resourcePath("article", seeded(21).slug), resourcePath("ebook", seeded(20).slug)]);
  });

  test("is the listing's rows under a heading: a region named by its h2, a list of rows, h3 titles, the type with its mark and the topics", async ({ page }) => {
    await page.goto(resourcePath(HOST.type, HOST.slug));
    const related = section(page);
    await expect(related.getByRole("heading", { level: 2, name: "Related resources" })).toHaveCount(1);
    await expect(related.getByRole("list").first()).toHaveClass(/rh-card-grid/);
    await expect(related.locator("ul.rh-card-grid > li > article.rh-card")).toHaveCount(3);
    await expect(related.locator("h3.rh-card__title")).toHaveCount(3);
    await expect(related.locator(".rh-card__type").first()).toHaveText("Case study");
    await expect(related.locator(".rh-card__type").first()).toHaveAttribute("data-accent", /./);
    await expect(related.locator(".rh-card").first().getByRole("list", { name: "Topics" })).toHaveText(/Performance/);
    // The section is the last thing in the article, after the body and the source line.
    const order = await page.locator("article.rh-resource > *").evaluateAll((nodes) => nodes.map((node) => node.className));
    expect(order.at(-1)).toBe("rh-related");
    expect(order.at(-2)).toBe("rh-resource__source");
    // Heading levels never skip downwards by more than one, with the section's h2 and its h3 rows included.
    const levels = await page.locator("h1, h2, h3, h4, h5, h6").evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1], `heading levels ${levels.join(", ")}`).toBeLessThanOrEqual(1);
    }
  });

  test("a resource with no topics and no picks has no section", async ({ page }) => {
    const slug = unique("nothing-related");
    await cms.createResource({ title: "Nothing related", type: "article", slug, topics: [] });
    await page.goto(resourcePath("article", slug));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing related");
    await expect(page.locator(".rh-related")).toHaveCount(0);
    await expect(section(page)).toHaveCount(0);
  });

  test("a resource with only topic matches lists them newest first", async ({ page }) => {
    const slug = unique("topic-only");
    await cms.createResource({ title: "Topic only", type: "podcast", slug, topics: ["accessibility"] });
    await page.goto(resourcePath("podcast", slug));
    // The accessibility resources, newest first (the seed's dates descend with its rows): 21, 23, 26.
    expect(await rowTitles(page)).toEqual([seeded(21).title, seeded(23).title, seeded(26).title]);
  });
});

test.describe("when the CMS cannot answer", () => {
  test("the page renders without the section when the related route fails, a 200 with nothing of the CMS in it, and with the section once the failure has passed", async ({ request, page }) => {
    const slug = unique("related-down");
    const created = await cms.createResource({ title: "Read while related is down", type: "article", slug, topics: ["performance"] });
    const path = resourcePath("article", slug);
    // The CMS's own failure page names its address; the page must not pass it on.
    await cms.addFault({ path: "/wp-json/resource-hub/v1/related", status: 500 });
    await cms.resetRequests();

    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html).toContain("Read while related is down");
    // No section: the class is in the inlined CSS whatever the page, so the check is for the element.
    expect(html).not.toContain('class="rh-related"');
    expect(html).not.toContain(`${MOCK_CMS_HOST}:${mockCmsPort()}`);
    // The failure came from the injected fault: the page did ask the related route.
    const { byPath } = await cms.requests();
    expect(byPath[`/wp-json/resource-hub/v1/related/${created.id}?count=3`]).toBe(1);

    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Read while related is down");
    await expect(page.locator(".rh-related")).toHaveCount(0);

    // The page without its section is a stored 200 like any other; the
    // resource's next event clears it, and with the fault gone the section renders.
    await cms.clearFaults();
    await revalidate(request, [await resourceEvent("publish", created.id)]);
    await page.goto(path);
    await expect(section(page)).toBeVisible();
    // The performance resources, newest first: 20, 23, 27.
    expect(await rowTitles(page)).toEqual([seeded(20).title, seeded(23).title, seeded(27).title]);
  });

  test("a CMS without the related route (core's 404 rest_no_route) gives a 200 page with no section", async ({ request, page }) => {
    const slug = unique("related-no-route");
    const created = await cms.createResource({ title: "Read on a CMS without the route", type: "article", slug, topics: ["performance"] });
    const path = resourcePath("article", slug);
    // What a CMS answers with the plugin deactivated, or a deploy behind the front end.
    await cms.addFault({ path: "/wp-json/resource-hub/v1/related", status: 404, code: "rest_no_route" });
    await cms.resetRequests();

    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html).toContain("Read on a CMS without the route");
    expect(html).not.toContain('class="rh-related"');
    // The route was asked, and answered with the fault's body.
    const { byPath } = await cms.requests();
    expect(byPath[`/wp-json/resource-hub/v1/related/${created.id}?count=3`]).toBe(1);

    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Read on a CMS without the route");
    await expect(page.locator(".rh-related")).toHaveCount(0);
  });

  test("the page renders without the section when the related route answers slowly past the data layer's timeout", async ({ request }) => {
    test.setTimeout(60_000);
    const slug = unique("related-slow");
    await cms.createResource({ title: "Read while related is slow", type: "article", slug, topics: ["performance"] });
    await cms.addFault({ path: "/wp-json/resource-hub/v1/related", delayMs: 12_000, times: 1 });
    const response = await request.get(resourcePath("article", slug), { timeout: 45_000 });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("Read while related is slow");
    expect(html).not.toContain('class="rh-related"');
  });
});

test.describe("freshness", () => {
  test("an unpublished pick leaves the section after its event, and the next topic match takes its place", async ({ request, page }) => {
    await page.goto(resourcePath(HOST.type, HOST.slug));
    expect(await rowTitles(page)).toEqual([seeded(29).title, seeded(21).title, seeded(20).title]);

    await cms.setStatus(29, "draft");
    await revalidate(request, [await resourceEvent("unpublish", 29)]);

    await page.goto(resourcePath(HOST.type, HOST.slug));
    // Pick 21 alone, then the newest sharing a topic: 20 and 22.
    expect(await rowTitles(page)).toEqual([seeded(21).title, seeded(20).title, seeded(22).title]);

    await cms.setStatus(29, "publish");
    await revalidate(request, [await resourceEvent("publish", 29)]);
    await page.goto(resourcePath(HOST.type, HOST.slug));
    expect(await rowTitles(page)).toEqual([seeded(29).title, seeded(21).title, seeded(20).title]);
  });
});
