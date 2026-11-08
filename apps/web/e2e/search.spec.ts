import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { wcagViolations } from "./axe.mts";
import { mockCms } from "./mock-cms/client.mts";
import { MOCK_CMS_HOST, mockCmsOrigin } from "./mock-cms/config.mts";

/**
 * The search page, `/search/?q=…&page=n` (issue #115), against the built app
 * and the mock CMS's search route: the form and its keyboard path, results
 * that mix resources and pages, pagination that keeps the query, the states
 * that make no request (no query, too short, a page the route would refuse),
 * no results, a CMS without the route, a CMS error, `noindex` in every
 * state, the status of every state, the paths under `/search/` the proxy
 * answers, and the Data Cache: the page renders on every request (it is the
 * one dynamic route, ADR 0043, amended) while a repeated query reads the CMS
 * once, until a revalidation event clears it. axe runs on each state here;
 * the results page is also in `sampled-urls.mts`, so `a11y.spec.ts` and
 * Lighthouse measure it.
 *
 * The app's Data Cache outlives the mock's reset (e2e/README.md), so each
 * test resets the mock, clears the cache through the revalidate route, and
 * searches for words of its own where it changes the CMS.
 */

const cms = mockCms();

/** A word of this run's own, so no cached search from an earlier run applies (e2e/README.md). */
const RUN = `probe${Date.now().toString(36)}`;

const SCHEMES = ["light", "dark"] as const;

test.beforeEach(async ({ request }) => {
  await cms.reset();
  await clearAppCache(request);
});

/** The mock's request counts for the search route, by query string. */
async function searchReads(): Promise<Record<string, number>> {
  const { byPath } = await cms.requests();
  return Object.fromEntries(Object.entries(byPath).filter(([path]) => path.startsWith("/wp-json/resource-hub/v1/search")));
}

async function robots(page: Page): Promise<string | null> {
  return page.locator('meta[name="robots"]').getAttribute("content");
}

async function rowTitles(page: Page): Promise<string[]> {
  return page.locator("main .rh-card-grid .rh-card__title").allInnerTexts();
}

async function createProbes(count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await cms.createResource({ slug: `${RUN}-${index}`, title: `${RUN} paging ${index}`, type: "article", summary: "A probe for the search page." });
  }
}

async function expectAccessible(page: Page): Promise<void> {
  for (const colorScheme of SCHEMES) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    expect(await wcagViolations(page), colorScheme).toEqual([]);
  }
}

test.describe("the search page", () => {
  test("renders the form alone with no query, a labelled search field in a search landmark, noindex and a 200", async ({ page }) => {
    await cms.resetRequests();
    const response = await page.goto("/search/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
    const form = page.getByRole("search");
    await expect(form).toBeVisible();
    const field = form.getByRole("searchbox", { name: "Search resources and pages" });
    await expect(field).toHaveAttribute("type", "search");
    await expect(field).toHaveAttribute("name", "q");
    await expect(field).toHaveValue("");
    await expect(form.getByRole("button", { name: "Search" })).toBeVisible();
    expect(await form.getAttribute("method")).toBe("get");
    expect(await form.getAttribute("action")).toBe("/search/");
    expect(await robots(page)).toBe("noindex");
    await expect(page).toHaveTitle(/^Search/);
    expect(await searchReads()).toEqual({});
    await expectAccessible(page);
  });

  test("is reached and used by keyboard alone: type, Enter, and the results in the order Tab reaches them", async ({ page }) => {
    await page.goto("/search/");
    const field = page.getByRole("searchbox", { name: "Search resources and pages" });
    // Tab from the top of the page reaches the field before anything in main.
    for (let step = 0; step < 10 && !(await field.evaluate((element) => element === document.activeElement)); step++) {
      await page.keyboard.press("Tab");
    }
    await expect(field).toBeFocused();
    await page.keyboard.type("team");
    await Promise.all([page.waitForURL("**/search/?q=team"), page.keyboard.press("Enter")]);
    await expect(page.getByRole("searchbox", { name: "Search resources and pages" })).toHaveValue("team");
    await expect(page.getByText("3 results for “team”")).toBeVisible();
    // Field, button, then the first row's link.
    await page.getByRole("searchbox").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Search" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("main .rh-card__link").first()).toBeFocused();
    // The button submits too.
    await page.getByRole("searchbox").fill("accessibility");
    await page.getByRole("searchbox").press("Tab");
    await Promise.all([page.waitForURL("**/search/?q=accessibility"), page.keyboard.press("Enter")]);
    await expect(page.getByText(/results for “accessibility”/)).toBeVisible();
  });

  test("lists resources and pages mixed, each row one link to its page on the front end, with the CMS nowhere in the HTML", async ({ page }) => {
    const response = await page.goto("/search/?q=team");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page).toHaveTitle(/^Results for “team”/);
    expect(await robots(page)).toBe("noindex");
    await expect(page.getByText("3 results for “team”")).toBeVisible();
    // The seed: resource 21's summary says "team"; pages 62 (/about/team/) and 66 (/company/team/) are titled so.
    expect(await rowTitles(page)).toEqual(["Alt text at scale", "The team", "The company team"]);
    const hrefs = await page.locator("main .rh-card__link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(hrefs).toEqual(["/resources/article/alt-text-at-scale/", "/about/team/", "/company/team/"]);
    // A resource row says its type with its mark; a page row says "Page", with no mark and no date.
    const pageRow = page.locator("main .rh-card").nth(1);
    await expect(pageRow.locator(".rh-card__kind")).toHaveText("Page");
    await expect(pageRow.locator(".rh-card__type, time")).toHaveCount(0);
    expect(await pageRow.locator(".rh-card__kind").evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none");
    await expect(page.locator("main .rh-card").first().locator(".rh-card__type")).toHaveAttribute("data-accent", /.+/);
    // Each row is one link: the stretched title.
    await page.locator("main .rh-card").nth(2).click({ position: { x: 5, y: 5 } });
    await page.waitForURL("**/company/team/");
    await page.goBack();
    const html = await (await page.request.get("/search/?q=team")).text();
    expect(html).not.toContain(mockCmsOrigin());
    expect(html).not.toContain(MOCK_CMS_HOST);
    await expectAccessible(page);
  });

  test("paginates with links that keep the query, a full page load each, and answers a page past the last with a way back", async ({ page, request }) => {
    await createProbes(13);
    await clearAppCache(request);
    await page.goto(`/search/?q=${RUN}+paging`);
    await expect(page.getByText(`13 results for “${RUN} paging”`)).toBeVisible();
    expect(await rowTitles(page)).toHaveLength(12);
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    await expect(pagination.getByRole("link", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    await expect(pagination.getByRole("link", { name: "Previous" })).toHaveCount(0);
    const next = pagination.getByRole("link", { name: "Next" });
    await expect(next).toHaveAttribute("href", `/search/?q=${RUN}+paging&page=2`);
    await Promise.all([page.waitForEvent("load"), next.click()]);
    expect(new URL(page.url()).search).toBe(`?q=${RUN}+paging&page=2`);
    expect(await rowTitles(page)).toHaveLength(1);
    await expect(page.getByRole("searchbox")).toHaveValue(`${RUN} paging`);
    await expect(pagination.getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    await expect(pagination.getByRole("link", { name: "Next" })).toHaveCount(0);
    await expect(pagination.getByRole("link", { name: "Previous" })).toHaveAttribute("href", `/search/?q=${RUN}+paging`);
    await expect(page).toHaveTitle(new RegExp(`page 2`));
    await expectAccessible(page);

    // Past the last page: a 200, the count, no rows, no pagination, and a link to page 1.
    const past = await page.goto(`/search/?q=${RUN}+paging&page=3`);
    expect(past?.status()).toBe(200);
    await expect(page.getByText("There are no results on page 3.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pagination" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to the first page of results" })).toHaveAttribute("href", `/search/?q=${RUN}+paging`);
  });

  test("answers a page the route would refuse with a 200 and no request", async ({ page }) => {
    await cms.resetRequests();
    for (const value of ["11", "0", "x", "02"]) {
      const response = await page.goto(`/search/?q=team&page=${value}`);
      expect(response?.status(), value).toBe(200);
      await expect(page.getByText("There are no results on this page.")).toBeVisible();
      expect(await robots(page)).toBe("noindex");
    }
    expect(await searchReads()).toEqual({});
  });

  test("says when nothing matches, with a 200 and a way to the library", async ({ page }) => {
    const response = await page.goto(`/search/?q=${RUN}zzz`);
    expect(response?.status()).toBe(200);
    await expect(page.getByText(`No results for “${RUN}zzz”.`)).toBeVisible();
    await expect(page.getByRole("link", { name: "browse all resources" })).toHaveAttribute("href", "/resources/");
    await expect(page.locator("main .rh-card")).toHaveCount(0);
    expect(await robots(page)).toBe("noindex");
    await expectAccessible(page);
  });

  test("says a query is too short or too long beside the field, with a 200 and no request", async ({ page }) => {
    await cms.resetRequests();
    const short = await page.goto("/search/?q=a");
    expect(short?.status()).toBe(200);
    const field = page.getByRole("searchbox", { name: "Search resources and pages" });
    await expect(field).toHaveValue("a");
    await expect(field).toHaveAccessibleDescription("Enter at least 2 characters to search.");
    expect(await robots(page)).toBe("noindex");
    await expectAccessible(page);
    const long = await page.goto(`/search/?q=${"a".repeat(101)}`);
    expect(long?.status()).toBe(200);
    await expect(page.getByRole("searchbox")).toHaveAccessibleDescription("Enter at most 100 characters to search.");
    expect(await searchReads()).toEqual({});
  });

  test("says search isn't available when the CMS has no search route, with a 200, never an error", async ({ page }) => {
    await cms.addFault({ path: "/wp-json/resource-hub/v1/search", status: 404, code: "rest_no_route" });
    const response = await page.goto(`/search/?q=${RUN}none`);
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Search isn’t available right now.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse all resources" })).toHaveAttribute("href", "/resources/");
    await expect(page.getByRole("searchbox")).toHaveAccessibleDescription("Search isn’t available right now.");
    expect(await robots(page)).toBe("noindex");
    await expectAccessible(page);
  });

  test("is a 500 with no-store when the CMS fails, never a cached or indexed page", async ({ request }) => {
    await cms.addFault({ path: "/wp-json/resource-hub/v1/search", status: 500 });
    const response = await request.get(`/search/?q=${RUN}down`);
    expect(response.status()).toBe(500);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.text()).not.toContain(MOCK_CMS_HOST);
  });

  test("renders on every request while a repeated query reads the CMS once, until a revalidation event clears it", async ({ request }) => {
    await cms.resetRequests();
    const path = `/search/?q=${RUN}+cache`;
    for (let index = 0; index < 3; index++) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers()["x-nextjs-cache"]).toBeUndefined();
    }
    expect(Object.values(await searchReads())).toEqual([1]);
    // `clearAppCache` sends term events, which clear the `resources` and `terms` tags every search read carries.
    await clearAppCache(request);
    await request.get(path);
    expect(Object.values(await searchReads())).toEqual([2]);
  });
});

test.describe("paths under /search/", () => {
  async function status(request: APIRequestContext, path: string): Promise<number> {
    return (await request.get(path, { maxRedirects: 0 })).status();
  }

  test("are a 404 from the path alone, as is a mixed-case /Search/, with no request", async ({ request }) => {
    await cms.resetRequests();
    for (const path of ["/search/x/", "/search/page/2/", "/search/x/y/", "/Search/?q=team"]) {
      expect(await status(request, path), path).toBe(404);
    }
    expect(Object.keys((await cms.requests()).byPath)).toEqual([]);
  });

  test("/search without its slash is the trailing-slash redirect, keeping the query", async ({ request }) => {
    const response = await request.get("/search?q=team", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe("/search/?q=team");
  });
});
