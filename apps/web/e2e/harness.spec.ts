import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { appSiteOrigin, mockCmsOrigin } from "./mock-cms/config.mts";
import { buildId } from "./mock-cms/identity.mts";

/**
 * Smoke checks on the harness itself: the mock CMS is up and the app under
 * test is wired to it. Later specs (listings, the resource page, the
 * revalidate route) build on what these prove.
 */

const cms = mockCms();

test.beforeEach(async () => {
  await cms.reset();
});

test("the mock answering is this checkout's current code, not one reused from elsewhere or from before a change", async () => {
  const health = await cms.health();
  const dir = join(dirname(test.info().file), "mock-cms");
  expect(health.dir).toBe(dir);
  expect(health.build, "the mock was started from older code: stop it and run again").toBe(buildId(dir));
  expect(health.origin).toBe(mockCmsOrigin());
});

/** What `/fixtures/app-identity/` answers (`app/fixtures/app-identity/route.fixture.tsx`). */
interface AppIdentity {
  dir: string;
  pid: number;
  startedAt: number;
  stamp: unknown;
}

test("the app answering is this checkout's harness build, started after that build was made", async ({ request }) => {
  const appDir = resolve(dirname(test.info().file), "..");
  const response = await request.get("/fixtures/app-identity/");
  expect(response.status(), `the app on ${appSiteOrigin()} has no /fixtures/app-identity/ route, so it is not this harness's fixture build: stop it and run again`).toBe(200);
  const app = (await response.json()) as AppIdentity;
  const who = `the app on ${appSiteOrigin()} (process ${app.pid}, running from ${app.dir})`;

  expect(app.dir, `${who} is another checkout's: stop it and run again`).toBe(appDir);

  // The build in .next is the harness's build of the commit checked out now,
  // for these ports: the test a prebuilt run makes before it starts the app
  // (e2e/build-stamp.mts), run as a command because this spec cannot import
  // that module.
  const check = spawnSync(process.execPath, ["e2e/build-stamp.mts", "verify"], { cwd: appDir, encoding: "utf8" });
  expect(check.status, `the build in .next is not this run's: ${check.stderr.trim()}`).toBe(0);

  // And the process answering loaded that build: it read the same stamp, and
  // it started after the build was written, so a rebuild since it started
  // (which `next start` would not pick up) fails here.
  const stamp: unknown = JSON.parse(readFileSync(join(appDir, ".next", "rh-e2e-build.json"), "utf8"));
  expect(app.stamp, `${who} loaded another build's stamp than the one in .next now: stop it and run again`).toEqual(stamp);
  const builtAt = statSync(join(appDir, ".next", "BUILD_ID")).mtimeMs;
  expect(
    app.startedAt >= builtAt,
    `${who} started at ${new Date(app.startedAt).toISOString()}, before the build in .next was made at ${new Date(builtAt).toISOString()}, so it serves an older build: stop it and run again`,
  ).toBe(true);
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
