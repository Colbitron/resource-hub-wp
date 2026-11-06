import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { appSiteOrigin, E2E_REVALIDATE_SECRET, mockCmsOrigin, mockCmsPort } from "./mock-cms/config.mts";

/**
 * The CMS's pages on the front end (root `CLAUDE.md`, "Pages"; ADR 0052)
 * against the built app and the mock CMS: `/` as the welcome page while no
 * front page is set and as the static front page once one is; every other
 * published page at its parent chain; the redirect contract (one computed
 * 308 with `no-store` for the front page's own slug, an upper-case letter and
 * a moved page's old path); the 404s (a draft, a wrong parent whose slug two
 * pages share, the posts page, a reserved first segment and a dotted segment,
 * the last two without a CMS request); the `pages` tag's freshness; and that
 * nothing of the CMS reaches the HTML.
 *
 * Changes to the mock are followed by the page event the CMS would send,
 * because the app's Data Cache does not see the mock change (e2e/README.md).
 */

const ROUTE = "/api/revalidate/";
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
  const response = await request.post(ROUTE, {
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

async function expectRedirect(response: APIResponse, location: string, path: string): Promise<void> {
  expect(response.status(), path).toBe(308);
  expect(response.headers()["location"], path).toBe(location);
  expect(cacheDirectives(response), path).toContain("no-store");
  expect(response.headers()["x-nextjs-cache"], path).toBeUndefined();
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
    expect(cacheDirectives(response)).toContain("no-store");
    expectNoCms(html, "/");
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
    const followed = await request.get(`/${WELCOME.slug}/`);
    expect(followed.status()).toBe(200);
    expect(followed.url()).toBe(`${appSiteOrigin()}/`);
  });

  test("goes back to the welcome page when the front page is unset or unpublished, after the event", async ({ request }) => {
    await cms.setFrontPage(WELCOME.id);
    await revalidate(request, [pageEvent("update", WELCOME.id, "/", `/${WELCOME.slug}/`)]);
    await expectPage(await get(request, "/"), WELCOME.title, "/");

    await cms.setFrontPage(null);
    // Stale until the CMS says so.
    await expectPage(await get(request, "/"), WELCOME.title, "/");
    await revalidate(request, [pageEvent("update", WELCOME.id, `/${WELCOME.slug}/`, "/")]);
    expect(await (await get(request, "/")).text()).toContain('<h1 class="rh-page__title">Resource Hub</h1>');
    await expectPage(await get(request, `/${WELCOME.slug}/`), WELCOME.title, `/${WELCOME.slug}/`);

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
    await expectPage(await get(request, `/${ABOUT.slug}/`), "About", `/${ABOUT.slug}/`);
  });

  test("a draft, the posts page, a page whose slug two pages share under a wrong parent, and a missing path are 404s", async ({ request }) => {
    for (const path of [`/${ABOUT.slug}/history/`, `/${NEWS.slug}/`, `/${TEAM.slug}/`, `/elsewhere/${TEAM.slug}/`, `/no-such-page-${Date.now()}/`]) {
      const response = await get(request, path);
      expect(response.status(), path).toBe(404);
      expect(response.headers()["location"], path).toBeUndefined();
      const html = await response.text();
      expect(html, path).toContain("<title>Page not found | Resource Hub</title>");
      expectNoCms(html, path);
    }
  });

  test("a reserved first segment or a dotted segment is a 404 without a request to the CMS", async ({ request }) => {
    await cms.resetRequests();
    for (const path of ["/api/", "/api/other/", "/media/", "/_next/", "/robots.txt", "/sitemap.xml", "/Resources/"]) {
      expect((await get(request, path)).status(), path).toBe(404);
    }
    const { byPath } = await cms.requests();
    expect(Object.keys(byPath).filter((path) => path.includes("resource-hub/v1/page"))).toEqual([]);
  });

  test("a page slugged api on the CMS is not served, and a page slugged api-2 is", async ({ request }) => {
    expect((await get(request, "/api/")).status()).toBe(404);
    const page = await cms.createPage({ title: "Saved after the rule", slug: "api-2" });
    await revalidate(request, [pageEvent("publish", page.id, "/api-2/", null)]);
    await expectPage(await get(request, "/api-2/"), "Saved after the rule", "/api-2/");
  });

  test("an upper-case letter in a segment redirects to the lower-case path, in one hop", async ({ request }) => {
    await expectRedirect(await get(request, `/About/${TEAM.slug}/`), `/${ABOUT.slug}/${TEAM.slug}/`, "/About/team/");
    await expectRedirect(await get(request, `/${ABOUT.slug}/Team/`), `/${ABOUT.slug}/${TEAM.slug}/`, "/about/Team/");
    const followed = await request.get(`/About/Team/`);
    expect(followed.status()).toBe(200);
    expect(followed.url()).toBe(`${appSiteOrigin()}/${ABOUT.slug}/${TEAM.slug}/`);
  });

  test("a moved page's old path redirects to its new one when its slug is unique, and both read after the event", async ({ request }) => {
    const oldPath = `/${ABOUT.slug}/${CONTACT.slug}/`;
    const newPath = `/${COMPANY.slug}/${CONTACT.slug}/`;
    await expectPage(await get(request, oldPath), CONTACT.title, oldPath);
    // Even before the move, a wrong parent with a unique slug redirects to the page's path.
    await expectRedirect(await get(request, newPath), oldPath, newPath);

    await cms.setPageParent(CONTACT.id, COMPANY.id);
    await revalidate(request, [pageEvent("update", CONTACT.id, newPath, oldPath)]);

    await expectRedirect(await get(request, oldPath), newPath, oldPath);
    await expectPage(await get(request, newPath), CONTACT.title, newPath);
    const followed = await request.get(oldPath);
    expect(followed.url()).toBe(`${appSiteOrigin()}${newPath}`);
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

  test("a trashed page is a 404 after its event, and a new page is served after its publish", async ({ request }) => {
    const path = `/${COMPANY.slug}/`;
    await expectPage(await get(request, path), "Company", path);
    await cms.setPageStatus(COMPANY.id, "trash");
    await revalidate(request, [pageEvent("trash", COMPANY.id, path, null)]);
    expect((await get(request, path)).status()).toBe(404);

    const created = await cms.createPage({ title: "Brand new", slug: `brand-new-${Date.now().toString(36)}`, parent: ABOUT.id });
    await revalidate(request, [pageEvent("publish", created.id, created.path, null)]);
    await expectPage(await get(request, created.path), "Brand new", created.path);
  });
});

test.describe("the page route's answer to a page event", () => {
  test("lists the two paths and nothing of the library's", async ({ request }) => {
    const response = await request.post(ROUTE, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
      data: JSON.stringify({ version: 1, events: [pageEvent("update", TEAM.id, "/company/team/", "/about/team/")] }),
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ revalidated: ["/about/team/", "/company/team/"] });
  });
});
