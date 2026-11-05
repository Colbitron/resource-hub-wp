import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { mockCmsOrigin, mockCmsPort } from "./mock-cms/config.mts";

/**
 * What a reader gets when there is nothing to show: the site's own 404 page
 * (`app/not-found.tsx`), in the shell, from `notFound()` in a listing and in
 * the resource page and for an unmatched URL (in the HTML for the last; after
 * hydration for the others, on Next.js 16.4.5, as measured below); and the
 * resource page's 500 when its CMS read fails, which the mock's fault
 * control (`/__mock/faults`, `mock-cms/faults.mts`) brings about. The
 * redirect contract, which neither may disturb, is checked once here and in
 * full in `resource-page.spec.ts` and `redirects.spec.ts`.
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
  /** `notFound()` from the resource page (no resource has this slug, current or old) and from the listings (an unknown type, an unknown topic, a page past the end). */
  const FROM_NOT_FOUND = [
    `/resources/webinar/${unique("no-such-resource")}/`,
    `/resources/${unique("no-such-type")}/`,
    `/resources/topic/${unique("no-such-topic")}/`,
    "/resources/page/99/",
  ];
  /** No route at all: Next.js serves the prerendered not-found page. */
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

  test("an unmatched URL's 404 is the site's page in the HTML, in the shell", async ({ request }) => {
    const html = await expectNotFoundResponse(await get(request, UNMATCHED), UNMATCHED);
    expect(html).toContain("<h1>Page not found</h1>");
    expect(html).toContain("There is no page at this address.");
    expect(html).toMatch(/<a [^>]*href="\/resources\/"[^>]*>Browse all resources<\/a>/);
    expect(html).toContain("Skip to content");
  });

  test("an unmatched URL's 404 reads with JavaScript off: one h1, the shell's landmarks and a link to the library", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      const response = await page.goto(UNMATCHED);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
      await expect(page.getByRole("main")).toContainText("There is no page at this address.");
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      await expect(page.getByRole("main").getByRole("link", { name: "Browse all resources" })).toHaveAttribute("href", "/resources/");
    } finally {
      await context.close();
    }
  });

  test("notFound() from the resource page and from each kind of listing is a 404 that shows the site's page in the shell", async ({ page, request }) => {
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

  test("measured on Next.js 16.4.5: a notFound() 404's HTML is the framework's empty error document, and the page arrives with the RSC payload", async ({ request }) => {
    // A notFound() thrown before the shell is flushed, which is where every
    // one here is thrown, makes Next.js send the 404 as `<html
    // id="__next_error__">` with an empty body and the not-found page only in
    // the inlined RSC payload, which the client renders on hydration; it has
    // no server-side fallback to the prerendered not-found page (ADR 0050's
    // 2026-11-05 amendment). If this starts failing after an upgrade, the
    // HTML carries the page: fold these paths into the unmatched URL's tests
    // and amend the ADR.
    for (const path of FROM_NOT_FOUND) {
      const html = await (await get(request, path)).text();
      expect(html, path).toContain('id="__next_error__"');
      expect(html, path).not.toContain("<h1>Page not found</h1>");
      expect(html, path).toContain("There is no page at this address.");
    }
  });

  test("leaves the redirect contract alone: a wrong type is still one 308 with no-store", async ({ request }) => {
    const response = await get(request, `/resources/podcast/${SEEDED.slug}/`);
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(`/resources/${SEEDED.type}/${SEEDED.slug}/`);
    expect(cacheDirectives(response)).toContain("no-store");
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
