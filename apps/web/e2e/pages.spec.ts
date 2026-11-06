import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { appSiteOrigin, E2E_REVALIDATE_SECRET, mockCmsOrigin, mockCmsPort } from "./mock-cms/config.mts";
import { postRevalidate } from "./revalidation.mts";

/**
 * The CMS's pages on the front end (ADR 0052; `packages/ui/README.md`) against
 * the built app and the mock CMS: `/` as the welcome page while no front page
 * is set and as the static front page once one is; every other published page
 * at its parent chain; the redirect contract (one computed 308 for the front
 * page's own slug and a moved page's old path, stored by ISR and sent with the
 * `headers()` rule's `Cache-Control`; the proxy's `no-store` 308 for an
 * upper-case letter); what ISR stores and what a page event clears (ADR 0052
 * and `docs/architecture/caching.md`: the welcome page and the front page at
 * `/`, a stored 308 at `/welcome/` and at a moved page's old path, a stored
 * 404 at a path a page is then published at); the 404s (a draft, a wrong
 * parent whose slug two pages share, the posts page, a reserved first segment
 * and a dotted segment, the last two without a CMS request); the `pages` tag's
 * freshness; the Chromium round trip that a browser-kept redirect would fail;
 * and that nothing of the CMS reaches the HTML.
 *
 * Changes to the mock are followed by the page event the CMS would send,
 * because the app's Data Cache does not see the mock change (e2e/README.md).
 */

const WELCOME = { id: 60, slug: "welcome", title: "Welcome to the hub" };
const ABOUT = { id: 61, slug: "about" };
const TEAM = { id: 62, slug: "team", title: "The team" };
const CONTACT = { id: 64, slug: "contact", title: "Contact" };
const COMPANY = { id: 65, slug: "company" };
const NEWS = { id: 68, slug: "news" };

const cms = mockCms();

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

/** A page event in the contract's shape. */
function pageEvent(event: string, id: number, path: string, previous: string | null) {
  return { type: "page", event, id, path, previous: previous === null ? null : { path: previous } };
}

async function revalidate(request: APIRequestContext, events: unknown[]): Promise<void> {
  const response = await postRevalidate(request, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
    data: JSON.stringify({ version: 1, events }),
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** Clears the pages tag, so a test starts from the mock's state whatever earlier tests cached. */
function clearPages(request: APIRequestContext): Promise<void> {
  return revalidate(request, [pageEvent("update", ABOUT.id, "/about/", "/about/")]);
}

function expectNoCms(html: string, path: string): void {
  expect(html, path).not.toContain(mockCmsOrigin());
  expect(html, path).not.toContain(`:${mockCmsPort()}`);
  expect(html, path).not.toContain("wp-json");
}

/**
 * The `Cache-Control` every response of the pages catch-all carries, from
 * the `headers()` rule in `next.config.ts` (`lib/route-headers.ts`): a
 * browser's copy is stale at once and may not be used without asking, so a
 * stored 308 is followed afresh each time.
 */
function expectRevalidateEachTime(response: APIResponse, path: string): void {
  const directives = cacheDirectives(response);
  expect(directives, path).toContain("max-age=0");
  expect(directives, path).toContain("must-revalidate");
  expect(directives, path).not.toContain("no-store");
  expect(directives.some((directive) => directive.startsWith("s-maxage")), path).toBe(false);
}

/** A 308 to `location`: from the route, stored by ISR with the header rule's `Cache-Control`; or from the proxy, `no-store` and never from any cache. */
async function expectRedirect(response: APIResponse, target: string, path: string, source: "stored" | "proxy" = "stored"): Promise<void> {
  expect(response.status(), path).toBe(308);
  expect(location(response), path).toBe(target);
  if (source === "proxy") {
    expect(cacheDirectives(response), path).toContain("no-store");
    expect(response.headers()["x-nextjs-cache"], path).toBeUndefined();
  } else {
    expectRevalidateEachTime(response, path);
    expect(response.headers()["x-nextjs-cache"], path).toMatch(/^(MISS|HIT)$/);
  }
}

/** A second request for a stored response: the same status, answered from the route cache. */
async function expectStored(request: APIRequestContext, path: string, status: number): Promise<APIResponse> {
  const response = await get(request, path);
  expect(response.status(), `${path} should still answer ${status}`).toBe(status);
  expect(response.headers()["x-nextjs-cache"], `${path} should be a route-cache hit`).toBe("HIT");
  expectRevalidateEachTime(response, path);
  return response;
}

async function expectPage(response: APIResponse, title: string, path: string): Promise<string> {
  expect(response.status(), path).toBe(200);
  const html = await response.text();
  expect(html, path).toContain(`<h1 class="rh-page__title">${title}</h1>`);
  expect(html, path).toContain(`<title>${title} | Resource Hub</title>`);
  expectNoCms(html, path);
  return html;
}

test.beforeEach(async ({ request }) => {
  await cms.reset();
  await clearPages(request);
});

test.describe("the root", () => {
  test("is the welcome page while no front page is set: a 200 with the site's name, a sentence and a link to the library", async ({ request }) => {
    const response = await get(request, "/");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h1 class="rh-page__title">Resource Hub</h1>');
    expect(html).toContain("<title>Resource Hub</title>");
    expect(html).toMatch(/<a [^>]*href="\/resources\/"[^>]*>Browse the library<\/a>/);
    expect(html).toContain(`<link rel="canonical" href="${appSiteOrigin()}/"`);
    expectRevalidateEachTime(response, "/");
    expectNoCms(html, "/");
    // Stored by ISR like any page, under the `pages` tag its lookup carries.
    expect(await (await expectStored(request, "/", 200)).text()).toContain('<h1 class="rh-page__title">Resource Hub</h1>');
  });

  test("is the static front page once one is set, with its body rewritten, and its own slug redirects to /", async ({ request }) => {
    await cms.setFrontPage(WELCOME.id);
    await revalidate(request, [pageEvent("update", WELCOME.id, "/", `/${WELCOME.slug}/`)]);

    const html = await expectPage(await get(request, "/"), WELCOME.title, "/");
    expect(html).toContain(`<link rel="canonical" href="${appSiteOrigin()}/"`);
    // The body's CMS links lose the CMS's origin, the external one stays, the upload becomes /media/.
    expect(html).toContain('href="/resources/ebook/a-field-guide-to-revalidation/"');
    expect(html).toContain('href="/resources/"');
    expect(html).toContain('href="https://example.com/elsewhere/"');
    // The sized upload renders through next/image, whose source is the same-origin /media/ path.
    expect(html).toContain("%2Fmedia%2F2026%2F11%2Fcontent-model.png");
    expect(html).not.toContain("wp-content/uploads");

    await expectRedirect(await get(request, `/${WELCOME.slug}/`), "/", `/${WELCOME.slug}/`);
    expect(location(await expectStored(request, `/${WELCOME.slug}/`, 308))).toBe("/");
    const followed = await request.get(`/${WELCOME.slug}/`);
    expect(followed.status()).toBe(200);
    expect(followed.url()).toBe(`${appSiteOrigin()}/`);
  });

  test("goes back to the welcome page when the front page is unset or unpublished, after the event, and the stored 308 at the page's own slug goes with it", async ({ request }) => {
    // The welcome page is stored at `/` first, so the swap is a change to a stored entry.
    expect(await (await get(request, "/")).text()).toContain('<h1 class="rh-page__title">Resource Hub</h1>');
    await expectStored(request, "/", 200);
    await cms.setFrontPage(WELCOME.id);
    await revalidate(request, [pageEvent("update", WELCOME.id, "/", `/${WELCOME.slug}/`)]);
    await expectPage(await get(request, "/"), WELCOME.title, "/");
    await expectRedirect(await get(request, `/${WELCOME.slug}/`), "/", `/${WELCOME.slug}/`);
    await expectStored(request, `/${WELCOME.slug}/`, 308);

    await cms.setFrontPage(null);
    // Stale until the CMS says so: the stored front page and the stored 308 are served as they are.
    await expectPage(await get(request, "/"), WELCOME.title, "/");
    await expectStored(request, `/${WELCOME.slug}/`, 308);
    await revalidate(request, [pageEvent("update", WELCOME.id, `/${WELCOME.slug}/`, "/")]);
    expect(await (await get(request, "/")).text()).toContain('<h1 class="rh-page__title">Resource Hub</h1>');
    await expectPage(await get(request, `/${WELCOME.slug}/`), WELCOME.title, `/${WELCOME.slug}/`);
    await expectStored(request, `/${WELCOME.slug}/`, 200);

    await cms.setFrontPage(WELCOME.id);
    await cms.setPageStatus(WELCOME.id, "draft");
    await revalidate(request, [pageEvent("unpublish", WELCOME.id, "/", null)]);
    expect(await (await get(request, "/")).text()).toContain('<h1 class="rh-page__title">Resource Hub</h1>');
    expect((await get(request, `/${WELCOME.slug}/`)).status()).toBe(404);
  });
});

test.describe("pages at their paths", () => {
  test("a nested page renders at its parent chain, with its title, canonical and excerpt", async ({ request }) => {
    const path = `/${ABOUT.slug}/${TEAM.slug}/`;
    const html = await expectPage(await get(request, path), TEAM.title, path);
    expect(html).toContain(`<link rel="canonical" href="${appSiteOrigin()}${path}"`);
    expect(html).toContain('<meta name="description" content="Who writes the resources."');
    expect(html).toContain('<meta property="og:type" content="website"');
    // Pages carry the site's default share image, their one og:image, so the large card, and Next.js's copy of the image.
    expect(html.match(/<meta property="og:image"/g)).toHaveLength(1);
    const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    expect(image).toMatch(/\/_next\/static\/media\/opengraph-image\.[^./]+\.png$/);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(html).not.toContain('<meta name="twitter:card" content="summary"/>');
    expect(html).toContain(`<meta name="twitter:image" content="${image}"/>`);
    await expectPage(await get(request, `/${ABOUT.slug}/`), "About", `/${ABOUT.slug}/`);
  });

  test("a draft, the posts page, a page whose slug two pages share under a wrong parent, and a missing path are 404s", async ({ request }) => {
    // The posts page counts only while a front page is set, as core reads page_for_posts.
    await expectPage(await get(request, `/${NEWS.slug}/`), "News", `/${NEWS.slug}/`);
    await cms.setFrontPage(WELCOME.id);
    await revalidate(request, [pageEvent("update", WELCOME.id, "/", `/${WELCOME.slug}/`), pageEvent("update", NEWS.id, `/${NEWS.slug}/`, `/${NEWS.slug}/`)]);
    for (const path of [`/${ABOUT.slug}/history/`, `/${NEWS.slug}/`, `/${TEAM.slug}/`, `/elsewhere/${TEAM.slug}/`, `/no-such-page-${Date.now()}/`]) {
      const response = await get(request, path);
      expect(response.status(), path).toBe(404);
      expect(location(response), path).toBeUndefined();
      const html = await response.text();
      expect(html, path).toContain("<title>Page not found | Resource Hub</title>");
      expectNoCms(html, path);
    }
  });

  test("a reserved first segment, a dotted segment or an over-long path is a 404 without a request to the CMS", async ({ request }) => {
    await cms.resetRequests();
    const tooLong = `/${Array.from({ length: 11 }, () => "a".repeat(200)).join("/")}/`;
    for (const path of ["/api/", "/api/other/", "/media/", "/_next/", "/robots.txt", "/sitemap.xml", tooLong]) {
      expect((await get(request, path)).status(), path).toBe(404);
    }
    const { byPath } = await cms.requests();
    expect(Object.keys(byPath).filter((path) => path.includes("resource-hub/v1/page"))).toEqual([]);
  });

  test("a segment the CMS sanitizes to nothing is a 404, never a 500", async ({ request }) => {
    for (const path of ["/-/", "/about/!!!/", "/~/"]) {
      const response = await get(request, path);
      expect(response.status(), path).toBe(404);
      expectNoCms(await response.text(), path);
    }
  });

  test("a page slugged api on the CMS is not served, and a page slugged api-2 is", async ({ request }) => {
    expect((await get(request, "/api/")).status()).toBe(404);
    const page = await cms.createPage({ title: "Saved after the rule", slug: "api-2" });
    await revalidate(request, [pageEvent("publish", page.id, "/api-2/", null)]);
    await expectPage(await get(request, "/api-2/"), "Saved after the rule", "/api-2/");
  });

  test("an upper-case letter in a segment, or an escape of one, gets the proxy's no-store 308 to the lower-case path, in one hop, before any route stores anything", async ({ request }) => {
    // From the proxy, never the route: Next.js keys a stored entry by the decoded path, and a
    // case-insensitive file system shares the key between `/About/` and `/about/`, so a
    // mixed-case request that reached the route first would store its 308 at the canonical
    // path's own key (measured; see `docs/architecture/caching.md`).
    await expectRedirect(await get(request, `/About/${TEAM.slug}/`), `/${ABOUT.slug}/${TEAM.slug}/`, "/About/team/", "proxy");
    await expectRedirect(await get(request, `/${ABOUT.slug}/Team/`), `/${ABOUT.slug}/${TEAM.slug}/`, "/about/Team/", "proxy");
    await expectRedirect(await get(request, `/%41bout/${TEAM.slug}/`), `/${ABOUT.slug}/${TEAM.slug}/`, "/%41bout/team/", "proxy");
    // The library's prefix too: the proxy covers every path now, so `/Resources/` is a case redirect, no longer a 404.
    await expectRedirect(await get(request, "/Resources/"), "/resources/", "/Resources/", "proxy");
    const followed = await request.get(`/About/Team/`);
    expect(followed.status()).toBe(200);
    expect(followed.url()).toBe(`${appSiteOrigin()}/${ABOUT.slug}/${TEAM.slug}/`);
    // And the canonical path's own entry is the page, not a redirect to itself.
    await expectPage(await get(request, `/${ABOUT.slug}/${TEAM.slug}/`), TEAM.title, `/${ABOUT.slug}/${TEAM.slug}/`);
  });

  test("a moved page's old path redirects to its new one when its slug is unique, both read after the event, and a move back clears the stored 308", async ({ request }) => {
    const oldPath = `/${ABOUT.slug}/${CONTACT.slug}/`;
    const newPath = `/${COMPANY.slug}/${CONTACT.slug}/`;
    await expectPage(await get(request, oldPath), CONTACT.title, oldPath);
    // Even before the move, a wrong parent with a unique slug redirects to the page's path; the 308 is stored.
    await expectRedirect(await get(request, newPath), oldPath, newPath);
    await expectStored(request, newPath, 308);

    await cms.setPageParent(CONTACT.id, COMPANY.id);
    await revalidate(request, [pageEvent("update", CONTACT.id, newPath, oldPath)]);

    // The event named both paths and the `pages` tag: the stored 308 at the new path is a page now, the old path a 308.
    await expectPage(await get(request, newPath), CONTACT.title, newPath);
    await expectRedirect(await get(request, oldPath), newPath, oldPath);
    await expectStored(request, oldPath, 308);
    const followed = await request.get(oldPath);
    expect(followed.url()).toBe(`${appSiteOrigin()}${newPath}`);

    // Moved back: the stored 308 at the old path must not survive, or it would point at a 308 pointing back.
    await cms.setPageParent(CONTACT.id, ABOUT.id);
    await revalidate(request, [pageEvent("update", CONTACT.id, oldPath, newPath)]);
    await expectPage(await get(request, oldPath), CONTACT.title, oldPath);
    await expectRedirect(await get(request, newPath), oldPath, newPath);
  });

  test("a renamed parent takes its own old path to a 404 and its children's old paths to a redirect, after the event", async ({ request }) => {
    await cms.setPageSlug(ABOUT.id, "about-us");
    await revalidate(request, [pageEvent("update", ABOUT.id, "/about-us/", `/${ABOUT.slug}/`)]);

    expect((await get(request, `/${ABOUT.slug}/`)).status()).toBe(404);
    await expectPage(await get(request, "/about-us/"), "About", "/about-us/");
    await expectPage(await get(request, `/about-us/${CONTACT.slug}/`), CONTACT.title, "/about-us/contact/");
    // `contact` is unique, so the child's old path redirects; `team` is not, so its old path is a 404.
    await expectRedirect(await get(request, `/${ABOUT.slug}/${CONTACT.slug}/`), `/about-us/${CONTACT.slug}/`, "/about/contact/");
    expect((await get(request, `/${ABOUT.slug}/${TEAM.slug}/`)).status()).toBe(404);
  });
});

test.describe("freshness through the pages tag", () => {
  test("a page's body is served from the Data Cache until a page event clears it, and a resource event leaves it alone", async ({ request }) => {
    const path = `/${ABOUT.slug}/${TEAM.slug}/`;
    const lookup = `/wp-json/resource-hub/v1/page?path=${encodeURIComponent(path)}`;
    const read = `/wp-json/wp/v2/pages/${TEAM.id}`;
    await cms.resetRequests();

    await expectPage(await get(request, path), TEAM.title, path);
    await expectPage(await get(request, path), TEAM.title, path);
    let { byPath } = await cms.requests();
    expect(byPath[lookup]).toBe(1);
    expect(byPath[read]).toBe(1);

    await cms.setPageContent(TEAM.id, "<p>Everyone who writes here.</p>");
    expect(await (await get(request, path)).text()).not.toContain("Everyone who writes here.");

    // A resource event clears nothing of the pages'.
    await revalidate(request, [
      {
        type: "resource",
        event: "update",
        id: 21,
        slug: "alt-text-at-scale",
        rest_url: `${mockCmsOrigin()}/wp-json/wp/v2/resources/21`,
        types: ["article"],
        topics: ["accessibility"],
        previous: { slug: "alt-text-at-scale", types: ["article"], topics: ["accessibility"] },
      },
    ]);
    expect(await (await get(request, path)).text()).not.toContain("Everyone who writes here.");
    ({ byPath } = await cms.requests());
    expect(byPath[read]).toBe(1);

    await revalidate(request, [pageEvent("update", TEAM.id, path, path)]);
    expect(await (await get(request, path)).text()).toContain("Everyone who writes here.");
    ({ byPath } = await cms.requests());
    expect(byPath[read]).toBe(2);
  });

  test("a trashed page is a 404 after its event, and a new page is served after its publish even where a 404 was stored", async ({ request }) => {
    const path = `/${COMPANY.slug}/`;
    await expectPage(await get(request, path), "Company", path);
    await cms.setPageStatus(COMPANY.id, "trash");
    await revalidate(request, [pageEvent("trash", COMPANY.id, path, null)]);
    expect((await get(request, path)).status()).toBe(404);
    await expectStored(request, path, 404);

    // A crawler found the path before the editor published there: the 404 is stored, and the publish event clears it.
    const slug = `brand-new-${Date.now().toString(36)}`;
    const newPath = `/${ABOUT.slug}/${slug}/`;
    expect((await get(request, newPath)).status()).toBe(404);
    await expectStored(request, newPath, 404);
    const created = await cms.createPage({ title: "Brand new", slug, parent: ABOUT.id });
    expect(created.path).toBe(newPath);
    await revalidate(request, [pageEvent("publish", created.id, created.path, null)]);
    await expectPage(await get(request, created.path), "Brand new", created.path);
  });

  test("a junk path's 404 is stored: the second request is a route-cache hit that asks the CMS nothing", async ({ request }) => {
    const path = `/no-such-page-${Date.now().toString(36)}/`;
    const lookup = `/wp-json/resource-hub/v1/page?path=${encodeURIComponent(path)}`;
    await cms.resetRequests();
    expect((await get(request, path)).status()).toBe(404);
    await expectStored(request, path, 404);
    await expectStored(request, path, 404);
    const { byPath } = await cms.requests();
    expect(byPath[lookup]).toBe(1);
  });
});

/** One navigation's redirect, as Chromium's network layer reported it. */
interface BrowserHop {
  from: string;
  status: number;
  cacheControl: string;
  fromCache: boolean;
}

/** Records every redirect Chromium follows on `page`, and whether its cache answered it, from the DevTools protocol (the technique of `e2e/resource-page.spec.ts`). */
async function watchRedirects(page: Page): Promise<BrowserHop[]> {
  const hops: BrowserHop[] = [];
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  session.on("Network.requestWillBeSent", (event) => {
    const redirect = event.redirectResponse;
    if (redirect === undefined) return;
    const cacheControl = Object.entries(redirect.headers).find(([name]) => name.toLowerCase() === "cache-control")?.[1] ?? "";
    hops.push({
      from: new URL(redirect.url).pathname,
      status: redirect.status,
      cacheControl: String(cacheControl),
      fromCache: redirect.fromDiskCache === true || redirect.fromPrefetchCache === true || redirect.fromServiceWorker === true,
    });
  });
  return hops;
}

/** Navigates Chromium to `from` and expects it to land on `to`, titled `title`, through at most one redirect that came from the server with `max-age=0`, never from Chromium's cache. */
async function expectBrowserLands(page: Page, hops: BrowserHop[], from: string, to: string, title: string): Promise<void> {
  hops.length = 0;
  const response = await page.goto(from);
  expect(new URL(page.url()).pathname, `${from} should land on ${to}`).toBe(to);
  expect(response?.status(), `${to} should answer 200`).toBe(200);
  await expect(page.locator("h1.rh-page__title")).toHaveText(title);
  expect(hops, `the redirects followed from ${from}`).toEqual(
    from === to ? [] : [{ from, status: 308, cacheControl: expect.stringMatching(/max-age=0/), fromCache: false }],
  );
}

test("in Chromium, a front page set and unset lands on the current page at every step, the stored 308 included", async ({ page, request }) => {
  const own = `/${WELCOME.slug}/`;
  const hops = await watchRedirects(page);
  await expectBrowserLands(page, hops, own, own, WELCOME.title);

  await cms.setFrontPage(WELCOME.id);
  await revalidate(request, [pageEvent("update", WELCOME.id, "/", own)]);
  // Twice: the second time the 308 is a route-cache hit, and Chromium must still ask the server for it.
  await expectBrowserLands(page, hops, own, "/", WELCOME.title);
  await expectBrowserLands(page, hops, own, "/", WELCOME.title);

  // Unset: a kept /welcome/ -> / redirect would now hide the page at its own path.
  await cms.setFrontPage(null);
  await revalidate(request, [pageEvent("update", WELCOME.id, own, "/")]);
  await expectBrowserLands(page, hops, own, own, WELCOME.title);
  await expectBrowserLands(page, hops, "/", "/", "Resource Hub");
});

test.describe("the page route's answer to a page event", () => {
  test("lists the two paths and nothing of the library's", async ({ request }) => {
    const response = await postRevalidate(request, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
      data: JSON.stringify({ version: 1, events: [pageEvent("update", TEAM.id, "/company/team/", "/about/team/")] }),
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ revalidated: ["/about/team/", "/company/team/"] });
  });
});
