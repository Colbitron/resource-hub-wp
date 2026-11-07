import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { RESOURCES, TERMS } from "./mock-cms/seed.mts";

/**
 * What the build prerenders, and what that buys the client (ADR 0053;
 * `lib/prerender.ts`): the harness builds the app while the mock is up, so
 * the library, each type's first page, the root and every seeded resource
 * (14, within the 50 newest) are prerendered and in the build's prefetch-hint
 * manifest. On a cold load of `/resources/` the client router then fetches a
 * visible row's route tree and page segment before any click, which it never
 * did while the routes were missing from the manifest (every segment was
 * marked prefetch-disabled), and never as a path of the library's own
 * catch-all, which the router's route prediction guessed for every row until
 * `next.config.ts` turned it off (the measurements are in
 * `docs/architecture/caching.md`, "Prefetching"). A resource outside the
 * prerendered set still renders on its first request and is stored, as every
 * resource did before.
 *
 * The requests are read off the wire through CDP, so what is checked is the
 * bytes a reader's browser would fetch, not the router's internal state.
 */

const cms = mockCms();

/** A seeded resource, newest first, that is not the library's lead; the lead is the first row's image, the rows are the links under it. */
const SEEDED_ROW = RESOURCES.filter((resource) => resource.status === "publish" && !resource.featured)[0];

const RUN = Date.now().toString(36);

interface Fetched {
  readonly pathname: string;
  readonly segment: string | undefined;
  readonly bytes: number;
  readonly status: number | undefined;
}

/** Every RSC request the page makes, with its segment header and its size on the wire, as CDP reports them. */
async function recordRscRequests(page: Page): Promise<Fetched[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const pending = new Map<string, { pathname: string; segment: string | undefined; rsc: boolean; status?: number }>();
  const fetched: Fetched[] = [];
  cdp.on("Network.requestWillBeSent", (event) => {
    const headers = Object.fromEntries(Object.entries(event.request.headers as Record<string, string>).map(([name, value]) => [name.toLowerCase(), value]));
    const url = new URL(event.request.url);
    pending.set(event.requestId, {
      pathname: url.pathname,
      segment: headers["next-router-segment-prefetch"],
      // The router marks its requests with the `RSC` header and, so a CDN never confuses them with the page, an `_rsc` query.
      rsc: headers["rsc"] === "1" || url.searchParams.has("_rsc"),
    });
  });
  cdp.on("Network.responseReceived", (event) => {
    const request = pending.get(event.requestId);
    if (request) request.status = event.response.status;
  });
  cdp.on("Network.loadingFinished", (event) => {
    const request = pending.get(event.requestId);
    if (request?.rsc) fetched.push({ pathname: request.pathname, segment: request.segment, bytes: event.encodedDataLength, status: request.status });
  });
  return fetched;
}

test.beforeEach(async () => {
  await cms.reset();
});

/** The prerendered HTML `next build` wrote for `path`, under `.next/server/app/`, as the harness built it. */
function prerenderedFile(path: string): string {
  const appDir = dirname(dirname(test.info().file));
  const name = path === "/" ? "index" : path.replace(/^\/|\/$/g, "");
  return join(appDir, ".next", "server", "app", `${name}.html`);
}

test.describe("the prerendered set", () => {
  test("the build wrote the library, each type's first page, the root and every seeded resource, and nothing else from the CMS", () => {
    const published = RESOURCES.filter((resource) => resource.status === "publish");
    const types = [...new Set(published.map((resource) => resource.type))];
    for (const path of ["/", "/resources/", ...types.map((type) => `/resources/${type}/`), ...published.map((resource) => `/resources/${resource.type}/${resource.slug}/`)]) {
      expect(existsSync(prerenderedFile(path)), `${path} should have been prerendered at build`).toBe(true);
    }
    // Topic listings, later pages and other CMS pages grow with what editors add, and stay on demand.
    for (const path of [`/resources/topic/${TERMS.find((term) => term.taxonomy === "resource_topic")!.slug}/`, "/resources/page/2/", `/resources/${types[0]}/page/2/`, "/welcome/", "/about/"]) {
      expect(existsSync(prerenderedFile(path)), `${path} should not have been prerendered`).toBe(false);
    }
  });

  test("a prerendered page is stored and served like any other: a 200 from the route cache, with no redirect", async ({ request }) => {
    // An earlier spec may have revalidated any of these since the build (the
    // pages spec clears `/`), so the first request here is not always the
    // build's copy; the second is a hit either way, which is what a reader
    // gets. The build's own output is checked on disk above.
    for (const path of ["/", "/resources/", `/resources/${SEEDED_ROW.type}/`, `/resources/${SEEDED_ROW.type}/${SEEDED_ROW.slug}/`]) {
      const first = await request.get(path, { maxRedirects: 0 });
      expect(first.status(), path).toBe(200);
      expect(first.headers().location, path).toBeUndefined();
      const second = await request.get(path, { maxRedirects: 0 });
      expect(second.status(), path).toBe(200);
      expect(second.headers()["x-nextjs-cache"], `${path} should be a route-cache hit`).toBe("HIT");
    }
  });

  test("a resource outside the set renders on its first request and is stored, like every resource before", async ({ request }) => {
    const slug = `published-after-the-build-${RUN}`;
    await cms.createResource({ title: "Published after the build", type: "article", slug });
    const path = `/resources/article/${slug}/`;
    const first = await request.get(path, { maxRedirects: 0 });
    expect(first.status()).toBe(200);
    expect(first.headers()["x-nextjs-cache"]).toBe("MISS");
    expect(await first.text()).toContain("Published after the build");
    const second = await request.get(path, { maxRedirects: 0 });
    expect(second.headers()["x-nextjs-cache"]).toBe("HIT");
  });

  test("a topic listing renders on its first request and is stored, as before", async ({ request }) => {
    // A slug of this run's own, so neither the build nor an earlier spec can have stored the listing.
    const topic = TERMS.find((term) => term.taxonomy === "resource_topic")!;
    const slug = `${topic.slug}-${RUN}`;
    await cms.renameTerm("resource_topic", topic.id, { slug });
    const path = `/resources/topic/${slug}/`;
    const first = await request.get(path, { maxRedirects: 0 });
    expect(first.status()).toBe(200);
    expect(first.headers()["x-nextjs-cache"]).toBe("MISS");
    expect((await request.get(path, { maxRedirects: 0 })).headers()["x-nextjs-cache"]).toBe("HIT");
  });
});

test.describe("prefetching from the library", () => {
  test("a cold load of /resources/ prefetches a visible row's route tree and page segment before any click", async ({ page }) => {
    const fetched = await recordRscRequests(page);
    await page.goto("/resources/");
    const row = page.getByRole("main").locator(".rh-card__link").first();
    const href = (await row.getAttribute("href")) as string;
    expect(href).toMatch(/^\/resources\/[^/]+\/[^/]+\/$/);

    // The router prefetches a link once it is in the viewport, in idle time;
    // wait for the row's segment data rather than a fixed interval.
    await expect
      .poll(() => fetched.filter((item) => item.pathname === href).map((item) => item.segment).sort(), { timeout: 10_000 })
      .toEqual(["/_tree", expect.stringMatching(/\/resources\/\$d\$type\/\$d\$slug\/__PAGE__$/)]);
    const forRow = fetched.filter((item) => item.pathname === href);
    for (const item of forRow) {
      expect(item.status, `${href} ${item.segment}`).toBe(200);
      expect(item.bytes, `${href} ${item.segment}`).toBeGreaterThan(0);
    }
    const bytes = forRow.reduce((sum, item) => sum + item.bytes, 0);
    test.info().annotations.push({ type: "prefetch bytes for the first row", description: `${bytes} B in ${forRow.length} requests` });

    // Nothing under `/resources/` but the library itself was fetched under
    // the catch-all's segment key: with route prediction on, the router
    // guessed every row and type link as a path of `[[...rest]]` and the
    // server answered 404 (`next.config.ts`, `optimisticRouting`).
    await page.waitForLoadState("networkidle");
    expect(fetched.filter((item) => item.pathname !== "/resources/" && item.segment?.includes("$oc$rest"))).toEqual([]);
    expect(fetched.filter((item) => item.status !== undefined && item.status >= 400).map((item) => `${item.status} ${item.pathname} ${item.segment}`)).toEqual([]);
  });

  test("a click on a prefetched row navigates without fetching the row's page segment again", async ({ page }) => {
    const fetched = await recordRscRequests(page);
    await page.goto("/resources/");
    const row = page.getByRole("main").locator(".rh-card__link").first();
    const href = (await row.getAttribute("href")) as string;
    const title = ((await row.textContent()) as string).trim();
    await expect.poll(() => fetched.filter((item) => item.pathname === href).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    const before = fetched.filter((item) => item.pathname === href).length;

    await row.click();
    await page.waitForURL(`**${href}`);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(title);
    // The navigation was served from the prefetched segments: no new request for the row's data.
    expect(fetched.filter((item) => item.pathname === href).length).toBe(before);
  });
});
