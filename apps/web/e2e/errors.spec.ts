import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { mockCmsOrigin, mockCmsPort } from "./mock-cms/config.mts";

/**
 * What a reader gets when there is nothing to show: the site's own 404 page
 * (`app/not-found.tsx`), in the shell. A 404 decided from the path alone is
 * answered by `proxy.ts` with a rewrite to `/404` with status 404
 * (`lib/path-decision.ts`, issue #46), the pathname Next.js's server treats
 * as its 404 page and Vercel serves its static `404.html` at, so the page
 * is in the HTML, with no JavaScript and no CMS request; `proxy.ts` has the
 * measurements on both servers, and this suite runs on `next start` only.
 * A 404 decided by data comes from a listing, the resource page or the page
 * route, which every URL no other route claims reaches (ADR 0052): each
 * renders `DataNotFound` (`components/DataNotFound.tsx`), which throws
 * `notFound()` inside a Suspense boundary whose fallback is the same page,
 * so its HTML has the page too, stored by ISR with the 404, whoever asks
 * first. And the resource page's 500 when its CMS read fails, which
 * the mock's fault control (`/__mock/faults`, `mock-cms/faults.mts`) brings
 * about. The redirect contract, which none of them may disturb, is checked
 * once here and in full in `resource-page.spec.ts` and `redirects.spec.ts`.
 */

const cms = mockCms();

const RUN = Date.now().toString(36);

function unique(slug: string): string {
  return `${slug}-${RUN}`;
}

/** A seeded webinar (ID 33). */
const SEEDED = { type: "webinar", slug: "revalidation-from-the-editors-chair" };

test.beforeEach(async () => {
  await cms.reset();
});

test.afterEach(async () => {
  // A reset clears faults too, but a fault must never outlive its test, even
  // into a spec file that does not reset in `beforeEach`.
  await cms.clearFaults();
});

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

function cacheDirectives(response: APIResponse): string[] {
  return (response.headers()["cache-control"] ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .filter((directive) => directive !== "");
}

/** The response's HTML has no trace of the CMS: its origin, its port, or its REST base. */
function expectNoCms(html: string, path: string): void {
  expect(html, path).not.toContain(mockCmsOrigin());
  expect(html, path).not.toContain(`:${mockCmsPort()}`);
  expect(html, path).not.toContain("wp-json");
}

test.describe("the 404 page", () => {
  /**
   * Paths no route could answer with anything but a 404, decided from the
   * path alone by the routes' own checks (`lib/path-decision.ts`): a dot in
   * a segment, a reserved first segment, a segment too long to be a slug, a
   * path over the plugin's cap, and under the library a shape no route has,
   * a page segment that is not a number and a reserved word as the type.
   */
  const PATH_DECIDED = [
    "/robots.txt",
    "/wp-login.php",
    "/.env",
    "/wp-admin/install.php",
    "/about/team.html",
    "/api/other/",
    "/api/Revalidate/",
    `/${"a".repeat(201)}/`,
    `/${Array.from({ length: 10 }, () => "a".repeat(200)).join("/")}/`,
    "/resources/topic/",
    "/resources/page/x/",
    "/resources/webinar/x/y/",
    "/resources/topic/topic/x/",
    "/Robots.TXT",
  ];
  /** A 404 decided by data in the resource page (no resource has this slug, current or old) and in the listings (an unknown type, an unknown topic, a page past the end). */
  const FROM_NOT_FOUND = [
    `/resources/webinar/${unique("no-such-resource")}/`,
    `/resources/${unique("no-such-type")}/`,
    `/resources/topic/${unique("no-such-topic")}/`,
    "/resources/page/99/",
  ];
  /**
   * A path no page has. Since ADR 0052 the root catch-all claims it and asks
   * the CMS, so it is a 404 decided by data like the others, not Next.js's
   * prerendered not-found page; the trade-off is recorded there.
   */
  const UNMATCHED = `/${unique("nowhere")}/`;

  /** What every 404 response carries in its HTML, whichever way it was reached. */
  async function expectNotFoundResponse(response: APIResponse, path: string): Promise<string> {
    expect(response.status(), path).toBe(404);
    const html = await response.text();
    expect(html, path).toContain("<title>Page not found | Resource Hub</title>");
    expect(html, path).toMatch(/<meta name="robots" content="noindex"/);
    expectNoCms(html, path);
    return html;
  }

  test("a 404 decided from the path alone has the site's page in its HTML, asks the CMS nothing, and tells a browser to ask again", async ({ request }) => {
    for (const path of PATH_DECIDED) {
      await cms.resetRequests();
      const response = await get(request, path);
      const html = await expectNotFoundResponse(response, path);
      expect(html, path).toContain("<h1>Page not found</h1>");
      expect(html, path).toContain("There is no page at this address.");
      expect(html, path).not.toContain('id="__next_error__"');
      // The proxy's rewrite is internal: no redirect, and the browser keeps the URL it asked for.
      expect(location(response), path).toBeUndefined();
      // The routes' own 404s carry this header (lib/route-headers.ts); the
      // rewrite puts the same one on, so no browser keeps a 404 and nothing
      // outlives a deploy that adds a route.
      expect(cacheDirectives(response), path).toContain("max-age=0");
      expect(cacheDirectives(response), path).toContain("must-revalidate");
      const { byPath } = await cms.requests();
      expect(Object.keys(byPath), path).toEqual([]);
    }
  });

  test("a 404 decided from the path alone is the build's one not-found entry, and stores nothing for its own URL", async ({ request }) => {
    // An ISR route stores what it answers under the URL it was asked for, so
    // its first answer for a new URL is a route-cache MISS and the next a HIT,
    // as the catch-all's own 404 shows. The proxy's rewrite serves the
    // prerendered not-found page's one entry instead, the same one a direct
    // request for `/404/` gets: a URL never asked for before is a HIT at
    // once, and every such URL gets the same document, so the same ETag
    // (measured on Next.js 16.4.5 under `next start`; on Vercel the CDN
    // serves its static `404.html` for every such URL from one cached copy).
    const junk = `/${unique("never-asked")}.php`;
    const responses: APIResponse[] = [];
    for (const path of [junk, junk, `/api/${unique("never-asked")}/`, "/404/"]) {
      const response = await get(request, path);
      expect(response.status(), path).toBe(404);
      expect(response.headers()["x-nextjs-cache"], path).toBe("HIT");
      responses.push(response);
    }
    const etags = responses.map((response) => response.headers()["etag"]);
    expect(etags[0]).toBeTruthy();
    expect(new Set(etags).size, JSON.stringify(etags)).toBe(1);
    const unmatched = `/${unique("stored-404")}/`;
    expect((await get(request, unmatched)).headers()["x-nextjs-cache"], unmatched).toBe("MISS");
    expect((await get(request, unmatched)).headers()["x-nextjs-cache"], unmatched).toBe("HIT");
  });

  test("a 404 decided from the path alone shows the site's page with JavaScript off, and the shell with it on", async ({ browser, page }) => {
    const noScript = await browser.newContext({ javaScriptEnabled: false });
    try {
      const plain = await noScript.newPage();
      const response = await plain.goto("/wp-login.php");
      expect(response?.status()).toBe(404);
      await expect(plain.getByRole("heading", { level: 1 })).toHaveText("Page not found");
      await expect(plain.getByRole("main")).toContainText("There is no page at this address.");
    } finally {
      await noScript.close();
    }
    const response = await page.goto("/resources/page/x/");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main").getByRole("link", { name: "Browse all resources" })).toHaveAttribute("href", "/resources/");
    // A client-side navigation to such a path gets the not-found page too: the rewrite answers the RSC request.
    await page.goto("/resources/");
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/api/other/";
      link.textContent = "junk";
      document.querySelector("main")?.append(link);
    });
    await page.getByRole("link", { name: "junk" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  });

  test("an unmatched URL is the page route's 404, decided by one CMS lookup, showing the site's page in the shell", async ({ page, request }) => {
    await cms.resetRequests();
    await expectNotFoundResponse(await get(request, UNMATCHED), UNMATCHED);
    const { byPath } = await cms.requests();
    expect(Object.keys(byPath).filter((path) => path.includes("resource-hub/v1/page"))).toHaveLength(1);
    const response = await page.goto(UNMATCHED);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(page.getByRole("main")).toContainText("There is no page at this address.");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main").getByRole("link", { name: "Browse all resources" })).toHaveAttribute("href", "/resources/");
  });

  test("a 404 decided by data in the resource page and in each kind of listing shows the site's page in the shell once hydrated", async ({ page, request }) => {
    for (const path of FROM_NOT_FOUND) {
      await expectNotFoundResponse(await get(request, path), path);
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1 }), path).toHaveText("Page not found");
      await expect(page.getByRole("main"), path).toContainText("There is no page at this address.");
      await expect(page.getByRole("banner"), path).toHaveCount(1);
      await expect(page.getByRole("main").getByRole("link", { name: "Browse all resources" }), path).toHaveAttribute("href", "/resources/");
    }
  });

  test("a 404 decided by data has the site's page in its HTML, and the stored copy keeps it", async ({ request }) => {
    // Before `DataNotFound`, Next.js 16.4.5 sent each of these as its empty
    // `<html id="__next_error__">` document, with the page only in the
    // inlined RSC payload (vercel/next.js#62228), and ISR stored that. The
    // first request renders and stores the 404 (a route-cache MISS) and the
    // second is served from the store (a HIT); both carry the page.
    const fresh = [
      `/resources/webinar/${unique("stored-resource")}/`,
      `/resources/${unique("stored-type")}/`,
      `/resources/topic/${unique("stored-topic")}/`,
      `/resources/webinar/topic/${unique("stored-topic")}/`,
      `/${unique("stored-nowhere")}/`,
    ];
    for (const path of fresh) {
      for (const expected of ["MISS", "HIT"]) {
        const response = await get(request, path);
        const html = await expectNotFoundResponse(response, path);
        expect(response.headers()["x-nextjs-cache"], path).toBe(expected);
        expect(html, path).toContain("<h1>Page not found</h1>");
        expect(html, path).toContain("There is no page at this address.");
        expect(html, path).not.toContain('id="__next_error__"');
        expect(location(response), path).toBeUndefined();
      }
    }
    // A page past the end has no unique URL to make fresh; it is the same page either way.
    const pastTheEnd = await expectNotFoundResponse(await get(request, "/resources/page/99/"), "/resources/page/99/");
    expect(pastTheEnd).toContain("<h1>Page not found</h1>");
    expect(pastTheEnd).not.toContain('id="__next_error__"');
  });

  test("a 404 decided by data has the page in its HTML when a crawler that runs no JavaScript asks first", async ({ request }) => {
    // Next.js renders metadata in the <head> for a user agent it counts as
    // unable to run JavaScript (Bingbot is one; Googlebot is not), outside
    // every Suspense boundary, and ISR stores whatever the first request
    // rendered for every reader: a `notFound()` thrown there sent the empty
    // document (measured 2026-11-06), so `generateMetadata` never throws it.
    const bingbot = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
    for (const path of [`/resources/webinar/${unique("crawled-first")}/`, `/resources/topic/${unique("crawled-first")}/`, `/${unique("crawled-first")}/`]) {
      const first = await request.get(path, { maxRedirects: 0, headers: { "user-agent": bingbot } });
      const stored = await get(request, path);
      for (const response of [first, stored]) {
        const html = await expectNotFoundResponse(response, path);
        expect(html, path).toContain("<h1>Page not found</h1>");
        expect(html, path).not.toContain('id="__next_error__"');
      }
      expect(stored.headers()["x-nextjs-cache"], path).toBe("HIT");
    }
  });

  test("a 404 decided by data shows the site's page with JavaScript off", async ({ browser }) => {
    const noScript = await browser.newContext({ javaScriptEnabled: false });
    try {
      const plain = await noScript.newPage();
      for (const path of [...FROM_NOT_FOUND, UNMATCHED]) {
        const response = await plain.goto(path);
        expect(response?.status(), path).toBe(404);
        await expect(plain.getByRole("heading", { level: 1 }), path).toHaveText("Page not found");
        await expect(plain.getByRole("main"), path).toContainText("There is no page at this address.");
        await expect(plain.getByRole("banner"), path).toHaveCount(1);
        await expect(plain.getByRole("main").getByRole("link", { name: "Browse all resources" }), path).toHaveAttribute("href", "/resources/");
      }
    } finally {
      await noScript.close();
    }
  });

  test("a client-side navigation to a 404 decided by data shows the site's page", async ({ page }) => {
    const missing = `/resources/webinar/${unique("navigated-to")}/`;
    await page.goto("/resources/");
    await page.evaluate((href) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = "missing";
      document.querySelector("main")?.append(link);
    }, missing);
    await page.getByRole("link", { name: "missing" }).click();
    await expect(page).toHaveURL(new RegExp(`${missing}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(page.getByRole("banner")).toHaveCount(1);
  });

  test("leaves the redirect contract alone: a wrong type is still one 308 that a browser must ask for again", async ({ request }) => {
    const response = await get(request, `/resources/podcast/${SEEDED.slug}/`);
    expect(response.status()).toBe(308);
    expect(location(response)).toBe(`/resources/${SEEDED.type}/${SEEDED.slug}/`);
    expect(cacheDirectives(response)).toContain("max-age=0");
    expect(cacheDirectives(response)).toContain("must-revalidate");
  });
});

test.describe("when the CMS fails", () => {
  test("a resource page whose CMS read fails is a 500 with no-store, and its body names nothing of the CMS", async ({ request }) => {
    const slug = unique("cms-down");
    await cms.createResource({ title: "Read while the CMS is down", type: "article", slug });
    const path = `/resources/article/${slug}/`;
    // The CMS's own failure page names its address; the front end must not pass it on.
    await cms.addFault({ path: "/wp-json/wp/v2/resources", status: 500 });
    await cms.resetRequests();

    const response = await get(request, path);
    expect(response.status(), path).toBe(500);
    expect(cacheDirectives(response)).toContain("no-store");
    expect(response.headers()["x-nextjs-cache"]).toBeUndefined();
    expectNoCms(await response.text(), path);
    // The 500 came from the injected fault: the front end did ask the CMS.
    const { byPath } = await cms.requests();
    expect(Object.keys(byPath).some((requested) => requested.startsWith("/wp-json/wp/v2/resources?"))).toBe(true);

    // Nothing of the failure was stored: with the fault cleared, the same URL renders.
    await cms.clearFaults();
    const recovered = await get(request, path);
    expect(recovered.status(), path).toBe(200);
    expect(await recovered.text()).toContain("Read while the CMS is down");
  });
});
