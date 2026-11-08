import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { mockCms } from "./mock-cms/client.mts";
import { E2E_REVALIDATE_SECRET, MOCK_CMS_HOST, mockCmsOrigin, mockCmsPort } from "./mock-cms/config.mts";
import { RESOURCES, TERMS } from "./mock-cms/seed.mts";
import { postRevalidate } from "./revalidation.mts";

/**
 * The `resource-hub/related-resources` block marker in a body, swapped for
 * `<RelatedResources>` (`components/RelatedResources.tsx`, issue #50; the
 * marker is in `packages/ui/README.md`, "Block marker") against the built
 * app and the mock CMS: in a resource's body and a CMS page's, the newest
 * resources in the marker's topic with the post the block sits in left out,
 * the heading from the marker and "More on {Topic}" without one, the heading
 * one level down with its rows under it when the body has an `h1`, nothing
 * of the marker or the CMS in the HTML, at most five markers swapped and one
 * fetch per topic; and the fallback, the CMS's own rows, when the block's
 * read fails, checked on a CMS page, whose own reads are other routes than
 * the resources collection the fault is on; a stray `rh-card__link` in a
 * marker stripped of its class, with every row link's stretched `::after`
 * inside its row and the block; and a swapped block kept as stored until a
 * resource event in its topic or the topic's rename event refreshes it,
 * through the app's real cache.
 *
 * Changes to the mock are followed by the event the CMS would send, because
 * the app's Data Cache does not see the mock change (e2e/README.md); what a
 * test creates gets a slug of this run's own.
 */

/** The seeded long-form article (ID 30): a marker for content modelling headed "More on content modelling". */
const LONG_FORM = { id: 30, type: "article", slug: "taxonomies-versus-meta" };
/** The seeded webinar (ID 33): a marker for editorial workflow headed "Related resources". */
const SEEDED = { id: 33, type: "webinar", slug: "revalidation-from-the-editors-chair" };

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

function topicId(slug: string): number {
  const term = TERMS.find((candidate) => candidate.taxonomy === "resource_topic" && candidate.slug === slug);
  if (term === undefined) throw new Error(`no seeded topic ${slug}`);
  return term.id;
}

interface MarkerOptions {
  readonly topic: string;
  readonly count?: number;
  /** The block's `<h2>`; `null` for a marker without one. */
  readonly heading?: string | null;
  /** The rows the CMS put in it: the row markup of `card.css`, or the block's first shape, a plain list of links. */
  readonly shape?: "cards" | "links";
  /** Markup put straight inside the wrapper, after the heading: for a body that writes into a marker. */
  readonly extra?: string;
}

/** A marker as the CMS block (a sibling branch, issue #50) writes it, with one row linking to a seeded resource on the CMS's origin. */
function marker({ topic, count = 3, heading = `More on ${topic}`, shape = "cards", extra = "" }: MarkerOptions): string {
  const origin = mockCmsOrigin();
  const href = `${origin}/resources/case-study/one-content-model-five-channels/`;
  const rows =
    shape === "cards"
      ? '<ul class="rh-card-grid" role="list"><li><article class="rh-card"><p class="rh-card__meta"><span class="rh-card__type">Case study</span><time datetime="2026-10-28T09:00:00Z">Oct 28, 2026</time></p>' +
        `<div class="rh-card__body"><h3 class="rh-card__title"><a class="rh-card__link" href="${href}">One content model, five channels</a></h3>` +
        '<p class="rh-card__summary">A publisher\'s move to a model that feeds every channel.</p><ul class="rh-card__topics" aria-label="Topics" role="list"><li class="rh-card__topic">Content modelling</li></ul></div></article></li></ul>'
      : `<ul><li><a href="${href}">One content model, five channels</a></li></ul>`;
  return (
    `<div class="wp-block-resource-hub-related-resources rh-related" data-rh-block="related-resources" data-count="${count}" data-topic="${topic}" data-topic-id="${topicId(topic)}" data-exclude="1">` +
    `${heading === null ? "" : `<h2>${heading}</h2>`}${extra}${rows}</div>`
  );
}

/** A schema-valid resource event for `id` in the mock's current state, with `previous` null, as a publish carries it. */
async function resourceEvent(event: "publish" | "update", id: number) {
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

/** The swapped block in a body: the front end's list, a `section`; the fallback is the marker's `div`. */
function swapped(page: Page): Locator {
  return page.locator(".rh-prose section.rh-related");
}

function fallback(page: Page): Locator {
  return page.locator(".rh-prose div.rh-related");
}

function titles(block: Locator): Promise<string[]> {
  return block.locator(".rh-card__title").allTextContents();
}

function expectNoCms(html: string, path: string): void {
  expect(html, `${path} names the CMS`).not.toContain(`${MOCK_CMS_HOST}:${mockCmsPort()}`);
}

test.beforeEach(async () => {
  await cms.reset();
});

test.afterEach(async ({ request }) => {
  // A fault must never outlive its test; the term events clear `terms` and
  // every `topic:` tag, which every block's read carries, so the seeded
  // pages are rendered again from the reset seed by whichever spec reads them next.
  await cms.clearFaults();
  await clearAppCache(request);
});

test.describe("the swap in a resource's body", () => {
  test("the long-form resource's marker renders as the front end's list: the marker's heading, the topic's newest with the host left out, and nothing of the marker or the CMS", async ({ page, request }) => {
    const path = resourcePath(LONG_FORM.type, LONG_FORM.slug);
    const html = await (await request.get(path)).text();
    expect(html).not.toContain("data-rh-block");
    expect(html).not.toContain("wp-block-resource-hub-related-resources");
    expectNoCms(html, path);

    await page.goto(path);
    const block = swapped(page);
    await expect(block).toHaveCount(1);
    await expect(fallback(page)).toHaveCount(0);
    await expect(block.getByRole("heading", { level: 2 })).toHaveText("More on content modelling");
    // The content-modelling resources newest first, without the host (30): 22, 24, 28.
    expect(await titles(block)).toEqual([seeded(22).title, seeded(24).title, seeded(28).title]);
    await expect(block.locator("h3.rh-card__title")).toHaveCount(3);
    await expect(block.getByRole("list").first()).toHaveClass(/rh-card-grid/);
    // The front end's rows carry the type mark's accent, which the CMS's rows do not.
    await expect(block.locator(".rh-card__type").first()).toHaveAttribute("data-accent", /./);
    await expect(block.locator(".rh-card__link").first()).toHaveAttribute("href", resourcePath("webinar", seeded(22).slug));
    // The block is not a landmark of its own; the page's related section under the article is.
    await expect(page.getByRole("region", { name: "More on content modelling" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Related resources" })).toHaveCount(1);
  });

  test("the seeded webinar's marker lists its topic's newest without itself", async ({ page }) => {
    await page.goto(resourcePath(SEEDED.type, SEEDED.slug));
    const block = swapped(page);
    await expect(block.getByRole("heading", { level: 2 })).toHaveText("Related resources");
    // Editorial workflow, newest first, without the host (33) and the draft (34): 21, 25, 28.
    expect(await titles(block)).toEqual([seeded(21).title, seeded(25).title, seeded(28).title]);
  });

  test("an editor's h1 shifts the block's heading to h3 and its rows to h4, under the body's own headings", async ({ page }) => {
    const slug = unique("shifted-block");
    await cms.createResource({
      title: "Shifted block",
      type: "article",
      slug,
      topics: ["performance"],
      content: `<h1>The editor's heading</h1><p>Body.</p>${marker({ topic: "performance", count: 2, heading: "Fast pages" })}`,
    });
    await page.goto(resourcePath("article", slug));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Shifted block");
    const body = page.locator(".rh-resource__body");
    await expect(body.getByRole("heading", { level: 2 })).toHaveText("The editor's heading");
    const block = swapped(page);
    await expect(block.getByRole("heading", { level: 3 })).toHaveText("Fast pages");
    await expect(block.locator("h4.rh-card__title")).toHaveCount(2);
    // The new resource is the newest in performance and is the host, so it is left out: 20 and 23 follow.
    expect(await titles(block)).toEqual([seeded(20).title, seeded(23).title]);
    const levels = await page.locator("h1, h2, h3, h4, h5, h6").evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1], `heading levels ${levels.join(", ")}`).toBeLessThanOrEqual(1);
    }
  });

  test("a marker with no heading takes More on the topic's name", async ({ page }) => {
    const slug = unique("unheaded-block");
    await cms.createResource({ title: "Unheaded block", type: "ebook", slug, topics: [], content: marker({ topic: "accessibility", heading: null }) });
    await page.goto(resourcePath("ebook", slug));
    const block = swapped(page);
    await expect(block.getByRole("heading", { level: 2 })).toHaveText("More on Accessibility");
    expect(await titles(block)).toEqual([seeded(21).title, seeded(23).title, seeded(26).title]);
  });

  test("at most five markers are swapped, one fetch per topic, and the sixth renders the CMS's rows", async ({ page }) => {
    const slug = unique("six-blocks");
    const topics = ["accessibility", "content-modelling", "editorial-workflow", "headless-delivery", "performance", "accessibility"];
    await cms.createResource({
      title: "Six blocks",
      type: "podcast",
      slug,
      topics: [],
      content: topics.map((topic) => `<p>${topic}</p>${marker({ topic, count: 4 })}`).join(""),
    });
    await cms.resetRequests();
    await page.goto(resourcePath("podcast", slug));
    await expect(swapped(page)).toHaveCount(5);
    await expect(fallback(page)).toHaveCount(1);
    await expect(fallback(page).locator("ul.rh-card-grid[role=list] > li > article.rh-card")).toHaveCount(1);
    await expect(fallback(page).getByRole("link", { name: "One content model, five channels" })).toHaveAttribute("href", resourcePath("case-study", seeded(24).slug));
    const { byPath } = await cms.requests();
    const blockReads = Object.keys(byPath).filter((requested) => requested.includes("per_page=10&orderby=date&order=desc&resource_topic="));
    expect(blockReads, blockReads.join("\n")).toHaveLength(5);
    expect(blockReads.every((requested) => byPath[requested] === 1)).toBe(true);
  });
});

test.describe("the swap on a CMS page, and the fallback when the block's read fails", () => {
  /** A page event in the contract's shape. */
  function pageEvent(event: string, id: number, path: string) {
    return { type: "page", event, id, path, previous: null };
  }

  test("a page's marker renders as the front end's list", async ({ page }) => {
    const created = await cms.createPage({ title: "A page with a block", slug: unique("page-block"), content: `<p>Intro.</p>${marker({ topic: "content-modelling" })}` });
    await page.goto(created.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A page with a block");
    const block = swapped(page);
    await expect(block.getByRole("heading", { level: 2 })).toHaveText("More on content-modelling");
    // A page is no resource, so nothing is left out: the three newest in content modelling.
    expect(await titles(block)).toEqual([seeded(22).title, seeded(24).title, seeded(28).title]);
  });

  test("when the read fails, the CMS's rows render in place: a 200 with the row classes, the lists' role and the topics' label kept, links root-relative and nothing of the CMS, and the swap returns after the page's event", async ({ page, request }) => {
    const created = await cms.createPage({ title: "Rows while the CMS is down", slug: unique("fallback-rows"), content: marker({ topic: "content-modelling" }) });
    await cms.addFault({ path: "/wp-json/wp/v2/resources", status: 500 });

    const response = await request.get(created.path);
    expect(response.status(), created.path).toBe(200);
    const html = await response.text();
    expectNoCms(html, created.path);
    expect(html).not.toContain("data-rh-block");
    expect(html).not.toContain('<section class="rh-related"');
    expect(html).toContain('<div class="wp-block-resource-hub-related-resources rh-related"><h2>More on content-modelling</h2><ul class="rh-card-grid" role="list"><li><article class="rh-card">');
    expect(html).toContain('<ul class="rh-card__topics" role="list" aria-label="Topics">');

    await page.goto(created.path);
    await expect(swapped(page)).toHaveCount(0);
    const rows = fallback(page);
    await expect(rows.getByRole("heading", { level: 2 })).toHaveText("More on content-modelling");
    await expect(rows.getByRole("list").first()).toHaveClass(/rh-card-grid/);
    await expect(rows.locator("ul.rh-card-grid > li > article.rh-card h3.rh-card__title a.rh-card__link")).toHaveAttribute(
      "href",
      resourcePath("case-study", seeded(24).slug),
    );
    await expect(rows.locator(".rh-card").getByRole("list", { name: "Topics" })).toHaveText("Content modelling");
    // The fallback's row has no accent, so its mark is the neutral ink.
    await expect(rows.locator(".rh-card__type")).not.toHaveAttribute("data-accent", /./);

    // The page without its swap is a stored 200; the page's next event clears it, and with the fault gone the swap renders.
    await cms.clearFaults();
    await revalidate(request, [pageEvent("publish", created.id, created.path)]);
    await page.goto(created.path);
    await expect(fallback(page)).toHaveCount(0);
    expect(await titles(swapped(page))).toEqual([seeded(22).title, seeded(24).title, seeded(28).title]);
  });

  test("a marker holding the block's first shape, a plain list of links, renders as before when the read fails", async ({ page, request }) => {
    const created = await cms.createPage({ title: "Links while the CMS is down", slug: unique("fallback-links"), content: marker({ topic: "content-modelling", shape: "links" }) });
    await cms.addFault({ path: "/wp-json/wp/v2/resources", status: 500 });
    const response = await request.get(created.path);
    expect(response.status(), created.path).toBe(200);
    const html = await response.text();
    expectNoCms(html, created.path);
    expect(html).toContain('<div class="wp-block-resource-hub-related-resources rh-related"><h2>More on content-modelling</h2><ul><li><a href="/resources/case-study/one-content-model-five-channels/">');
    // No row in the page: the row classes are in the inlined CSS whatever the page, so the check is for an element.
    expect(html).not.toContain('class="rh-card');

    await page.goto(created.path);
    await expect(fallback(page).getByRole("link", { name: "One content model, five channels" })).toBeVisible();
    await expect(fallback(page).locator(".rh-card")).toHaveCount(0);
  });
});

test.describe("containment of the rows' stretched links", () => {
  test("a stray rh-card__link straight inside a marker loses the class, and every row link's ::after stays inside the block", async ({ page, request }) => {
    const stray = '<a class="rh-card__link" href="/resources/">Stray link</a>';
    const created = await cms.createPage({
      title: "A marker with a stray link",
      slug: unique("stray-link"),
      content: `<p>Intro.</p>${marker({ topic: "content-modelling", extra: stray })}`,
    });
    // The fallback is what renders the marker's own contents.
    await cms.addFault({ path: "/wp-json/wp/v2/resources", status: 500 });
    const html = await (await request.get(created.path)).text();
    expect(html).toContain('<a href="/resources/">Stray link</a>');

    await page.goto(created.path);
    const rows = fallback(page);
    await expect(rows).toHaveCount(1);
    const strayLink = rows.getByRole("link", { name: "Stray link" });
    await expect(strayLink).not.toHaveAttribute("class", /./);
    await expect(rows).toHaveCSS("position", "relative");

    const boxes = await rows.evaluate((block) => {
      const outer = block.getBoundingClientRect();
      return [...block.querySelectorAll("a")].map((link) => {
        const after = getComputedStyle(link, "::after");
        // The ::after's containing block is the link's nearest positioned ancestor.
        let holder: Element | null = link.parentElement;
        while (holder !== null && getComputedStyle(holder).position === "static") holder = holder.parentElement;
        const box = holder?.getBoundingClientRect();
        return {
          text: link.textContent,
          stretched: after.position === "absolute" && after.content !== "none",
          holder: holder === null ? null : `${holder.tagName.toLowerCase()}.${holder.className}`,
          inside:
            box !== undefined &&
            block.contains(holder) &&
            box.top >= outer.top &&
            box.left >= outer.left &&
            box.bottom <= outer.bottom &&
            box.right <= outer.right,
        };
      });
    });
    // The stray link stretches nothing; the row's link stretches over its row alone, inside the block.
    expect(boxes.find((box) => box.text === "Stray link")?.stretched).toBe(false);
    const stretched = boxes.filter((box) => box.stretched);
    expect(stretched, JSON.stringify(boxes)).toHaveLength(1);
    expect(stretched[0]).toMatchObject({ holder: "article.rh-card", inside: true });
  });
});

test.describe("freshness through the app's cache", () => {
  test("a resource event in the block's topic refreshes a swapped block, which stays as stored until then", async ({ page, request }) => {
    const created = await cms.createPage({ title: "A block kept fresh", slug: unique("fresh-block"), content: marker({ topic: "headless-delivery" }) });
    await page.goto(created.path);
    const before = await titles(swapped(page));
    expect(before).toHaveLength(3);

    const title = `Newest in headless delivery ${RUN}`;
    const resource = await cms.createResource({ title, type: "article", slug: unique("newest-headless"), topics: ["headless-delivery"] });
    // No event yet: the page and its block's read are served as stored.
    await page.reload();
    expect(await titles(swapped(page))).toEqual(before);

    await revalidate(request, [await resourceEvent("publish", resource.id)]);
    await page.reload();
    expect(await titles(swapped(page))).toEqual([title, ...before.slice(0, 2)]);
  });

  test("a topic rename refreshes a swapped block's heading and row labels after the term's event", async ({ page, request }) => {
    const topic = TERMS.find((term) => term.taxonomy === "resource_topic" && term.slug === "accessibility");
    if (topic === undefined) throw new Error("no seeded accessibility topic");
    const created = await cms.createPage({ title: "A block for a renamed topic", slug: unique("renamed-topic"), content: marker({ topic: "accessibility", heading: null }) });
    await page.goto(created.path);
    const block = swapped(page);
    await expect(block.getByRole("heading", { level: 2 })).toHaveText("More on Accessibility");

    const name = `Inclusive design ${RUN}`;
    await cms.renameTerm("resource_topic", topic.id, { name });
    await page.reload();
    await expect(block.getByRole("heading", { level: 2 })).toHaveText("More on Accessibility");

    await revalidate(request, [
      { type: "term", taxonomy: "resource_topic", event: "update", id: topic.id, slug: topic.slug, name, previous: { slug: topic.slug, name: topic.name } },
    ]);
    await page.reload();
    await expect(block.getByRole("heading", { level: 2 })).toHaveText(`More on ${name}`);
    await expect(block.locator(".rh-card__topic", { hasText: name }).first()).toBeVisible();
    await expect(block.locator(".rh-card__topic", { hasText: /^Accessibility$/ })).toHaveCount(0);
  });
});
