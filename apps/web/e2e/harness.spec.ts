import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { mockCmsOrigin } from "./mock-cms/config.mts";

/**
 * Smoke checks on the harness itself: the mock CMS is up and the app under
 * test is wired to it. Later specs (listings, the resource page, the
 * revalidate route) build on what these prove.
 */

const cms = mockCms();

test.beforeEach(async () => {
  await cms.reset();
});

test("the mock answering is this checkout's, not one reused from elsewhere", async () => {
  const health = await cms.health();
  expect(health.dir).toBe(join(dirname(test.info().file), "mock-cms"));
  expect(health.origin).toBe(mockCmsOrigin());
});

test.describe("the /media/ rewrite", () => {
  test("serves the mock's upload byte for byte", async ({ request }) => {
    const file = "2026/11/content-model.png";
    const expected = await readFile(resolve(dirname(test.info().file), "mock-cms/fixtures/uploads", file));

    const response = await request.get(`/media/${file}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    expect(Buffer.from(await response.body()).equals(expected)).toBe(true);

    const counts = await cms.requests();
    expect(counts.byPath[`/wp-content/uploads/${file}`]).toBe(1);
  });

  test("passes a missing upload through as the CMS's 404", async ({ request }) => {
    const response = await request.get("/media/2026/11/not-here.png");
    expect(response.status()).toBe(404);
  });
});

test.describe("rendered HTML carries no CMS address", () => {
  for (const path of ["/", "/fixtures/cards/"]) {
    test(`${path} names neither the mock's origin nor wp-content`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).not.toContain(mockCmsOrigin());
      expect(html).not.toContain("wp-content");
    });
  }
});

test.describe("the mock's control endpoints", () => {
  test("renaming a slug makes the old one resolve to the new", async () => {
    const { resources } = await cms.state();
    const resource = resources.find((candidate) => candidate.slug === "alt-text-at-scale");
    if (!resource) throw new Error("the seed has no alt-text-at-scale");

    const renamed = await cms.renameSlug(resource.id, "alt-text-at-any-scale");
    expect(renamed.previousSlugs).toEqual(["alt-text-at-scale"]);

    const byOldSlug = await cms.resolve("alt-text-at-scale");
    expect(byOldSlug.status).toBe(200);
    expect(byOldSlug.headers.get("cache-control")).toBe("no-cache, must-revalidate, max-age=0");
    expect(byOldSlug.body).toEqual({ id: resource.id, type: "article", slug: "alt-text-at-any-scale" });

    const byNewSlug = await cms.resolve("alt-text-at-any-scale");
    expect(byNewSlug.body).toEqual(byOldSlug.body);

    const unknown = await cms.resolve("never-a-slug");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: "resource_hub_not_found", data: { status: 404 } });
  });

  test("reset puts the seed back and clears the counters", async () => {
    const { resources } = await cms.state();
    await cms.renameSlug(resources[0].id, "renamed-for-a-moment");
    expect((await cms.resolve("renamed-for-a-moment")).status).toBe(200);
    expect((await cms.requests()).total).toBe(1);

    await cms.reset();
    expect((await cms.requests()).total).toBe(0);
    expect((await cms.resolve("renamed-for-a-moment")).status).toBe(404);
    expect((await cms.state()).resources[0].slug).toBe(resources[0].slug);
  });
});
