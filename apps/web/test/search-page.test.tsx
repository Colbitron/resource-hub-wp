import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchPage, searchMetadata } from "../components/SearchPage";
import { parseSearchRequest } from "../lib/search-request";
import { toPageCard, UNTITLED_PAGE } from "../lib/wp/cards";
import { CmsError } from "../lib/wp/fetch";
import { wpPageSchema, wpResourceSchema, type WpPage } from "../lib/wp/schemas/rest";
import { searchSite, type SearchResults } from "../lib/wp/search";

vi.mock("../lib/wp/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/wp/search")>()),
  searchSite: vi.fn(),
}));

/**
 * The search page's states (issue #115), rendered from a request with
 * `searchSite` stubbed: which state each request shows, that only a valid
 * query and page make a read, what the rows, the count and the pagination
 * say, that a CMS without the route is a sentence and never an error, that a
 * `CmsError` leaves the page for its error boundary, and the metadata's
 * `noindex`. The page rows' paths are `toPageCard`'s, tested here too.
 */

const API = "https://cms.example/wp-json";
const here = path.dirname(fileURLToPath(import.meta.url));
const RESOURCES = (JSON.parse(readFileSync(path.join(here, "fixtures/wp/resources.list.json"), "utf8")) as unknown[]).map((resource) => wpResourceSchema.parse(resource));

function wpPage(id: number, link: string, overrides: Record<string, unknown> = {}): WpPage {
  return wpPageSchema.parse({
    id,
    slug: `page-${id}`,
    link,
    parent: 0,
    date_gmt: "2026-11-01T09:00:00",
    modified_gmt: "2026-11-02T10:00:00",
    title: { rendered: `About &amp; us ${id}` },
    content: { rendered: "<p>Body.</p>", protected: false },
    excerpt: { rendered: "<p>Who we are.</p>\n", protected: false },
    ...overrides,
  });
}

const search = vi.mocked(searchSite);

async function render(params: { q?: string | string[]; page?: string }): Promise<string> {
  return renderToStaticMarkup(await SearchPage({ request: parseSearchRequest(params) }));
}

function results(overrides: Partial<SearchResults> = {}): SearchResults {
  return {
    items: [
      { type: "resource", resource: RESOURCES[0] },
      { type: "page", page: wpPage(7, "https://cms.example/about/") },
      { type: "resource", resource: RESOURCES[1] },
    ],
    total: 30,
    pages: 3,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("WP_API_URL", API);
  vi.stubEnv("WP_MEDIA_ORIGIN", "");
  search.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the search page", () => {
  it("always renders a labelled GET search form to /search/ that keeps the visitor's words", async () => {
    for (const params of [{}, { q: "a" }, { q: "  core  vitals " }]) {
      search.mockResolvedValue(results());
      const html = await render(params);
      expect(html).toContain('<form class="rh-search" role="search" action="/search/" method="get">');
      expect(html).toContain('<label class="rh-search__label" for="rh-search-q">Search resources and pages</label>');
      const input = html.match(/<input [^>]*\/>/)?.[0] ?? "";
      for (const attribute of ['class="rh-search__input"', 'id="rh-search-q"', 'type="search"', 'name="q"']) {
        expect(input).toContain(attribute);
      }
      expect(html).toContain('<button class="rh-search__button" type="submit">Search</button>');
        expect(input).toContain(`value="${params.q ?? ""}"`);
      expect(html.match(/<h1/g)).toHaveLength(1);
    }
  });

  it("with no query shows the form alone, describes nothing and reads nothing", async () => {
    const html = await render({});
    expect(search).not.toHaveBeenCalled();
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("rh-search-message");
  });

  it("says a query is too short or too long beside the form, tied to the input, and reads nothing", async () => {
    const short = await render({ q: "a" });
    expect(short).toContain('aria-describedby="rh-search-message"');
    expect(short).toContain('<p id="rh-search-message">Enter at least 2 characters to search.</p>');
    const long = await render({ q: "a".repeat(101) });
    expect(long).toContain('<p id="rh-search-message">Enter at most 100 characters to search.</p>');
    expect(search).not.toHaveBeenCalled();
  });

  it("reads the normalised query and page, and lists resources and pages in the route's order", async () => {
    search.mockResolvedValue(results());
    const html = await render({ q: "  revalidation  ", page: "2" });
    expect(search).toHaveBeenCalledExactlyOnceWith("revalidation", 2);
    expect(html).toContain('<p class="rh-search__summary" id="rh-search-message">30 results for “revalidation”</p>');
    const titles = [...html.matchAll(/<h2 class="rh-card__title"><a class="rh-card__link" href="([^"]+)">([^<]+)<\/a>/g)].map((match) => [match[1], match[2]]);
    // `<Link>` outside the app's router drops the trailing slash `trailingSlash: true` adds back in the app.
    expect(titles).toEqual([
      [expect.stringMatching(/^\/resources\/[^/]+\/a-field-guide-to-revalidation\/?$/), expect.any(String)],
      [expect.stringMatching(/^\/about\/?$/), "About &amp; us 7"],
      [expect.stringMatching(/^\/resources\/[^/]+\/alt-text-at-scale\/?$/), expect.any(String)],
    ]);
    // The page row: the label without a mark, no date, the excerpt as plain text.
    expect(html).toContain('<p class="rh-card__meta"><span class="rh-card__kind">Page</span></p>');
    expect(html).toContain('<p class="rh-card__summary">Who we are.</p>');
    // The resource rows keep their type mark.
    expect(html).toMatch(/<span class="rh-card__type" data-accent="[a-z]+">/);
  });

  it("paginates with plain links that keep the query, up to the route's pages", async () => {
    search.mockResolvedValue(results({ pages: 3 }));
    const html = await render({ q: "core vitals", page: "2" });
    expect(html).toContain('<nav class="rh-pagination" aria-label="Pagination">');
    expect(html).toContain('<a class="rh-pagination__link" href="/search/?q=core+vitals" rel="prev">Previous</a>');
    expect(html).toContain('<a class="rh-pagination__link" href="/search/?q=core+vitals&amp;page=3" rel="next">Next</a>');
    expect(html).toContain('href="/search/?q=core+vitals&amp;page=2" aria-label="Page 2" aria-current="page"');
    search.mockResolvedValue(results({ pages: 1, total: 3 }));
    expect(await render({ q: "core vitals" })).not.toContain("rh-pagination");
  });

  it("says when matches pass the 120 the route lists", async () => {
    search.mockResolvedValue(results({ total: 121, pages: 10 }));
    expect(await render({ q: "ab" })).toContain("121 results for “ab”. The first 120 are listed; add words to narrow the search.");
    search.mockResolvedValue(results({ total: 120, pages: 10 }));
    expect(await render({ q: "ab" })).not.toContain("The first 120");
  });

  it("says one result in the singular", async () => {
    search.mockResolvedValue(results({ items: [{ type: "resource", resource: RESOURCES[0] }], total: 1, pages: 1 }));
    expect(await render({ q: "ab" })).toContain("1 result for “ab”");
  });

  it("says there are no results, and offers the library", async () => {
    search.mockResolvedValue({ items: [], total: 0, pages: 0 });
    const html = await render({ q: "zzzz" });
    expect(html).toContain('<p id="rh-search-message">No results for “zzzz”.</p>');
    expect(html).toMatch(/<a href="\/resources\/?">browse all resources<\/a>/);
    expect(html).not.toContain("rh-card-grid");
    expect(html).not.toContain("rh-pagination");
  });

  it("answers a page past the last with the count and a link to the first page", async () => {
    search.mockResolvedValue({ items: [], total: 30, pages: 3 });
    const html = await render({ q: "core vitals", page: "5" });
    expect(search).toHaveBeenCalledExactlyOnceWith("core vitals", 5);
    expect(html).toContain("30 results for “core vitals”");
    expect(html).toContain("There are no results on page 5.");
    expect(html).toContain('<a href="/search/?q=core+vitals">Go to the first page of results</a>');
    expect(html).not.toContain("rh-pagination");
  });

  it("answers a page the route would refuse with the same state and no read", async () => {
    const html = await render({ q: "core vitals", page: "11" });
    expect(search).not.toHaveBeenCalled();
    expect(html).toContain('<p id="rh-search-message">There are no results on this page.</p>');
    expect(html).toContain('<a href="/search/?q=core+vitals">Go to the first page of results</a>');
  });

  it("says search isn't available when the CMS has no search route, and never fails", async () => {
    search.mockResolvedValue(null);
    const html = await render({ q: "core vitals" });
    expect(html).toContain('<p id="rh-search-message">Search isn’t available right now.</p>');
    expect(html).toMatch(/<a href="\/resources\/?">Browse all resources<\/a>/);
    expect(html).not.toContain("cms.example");
  });

  it("says the rows can't be shown when every hit on the page lacks a URL", async () => {
    search.mockResolvedValue(results({ items: [{ type: "page", page: wpPage(7, "https://elsewhere.example/about/") }] }));
    expect(await render({ q: "ab" })).toContain("The results on this page can’t be shown.");
  });

  it("lets a CmsError through to the route's error boundary", async () => {
    search.mockRejectedValue(new CmsError("/resource-hub/v1/search", "status", "an answer the request did not expect", 500));
    await expect(render({ q: "ab" })).rejects.toBeInstanceOf(CmsError);
  });
});

describe("searchMetadata", () => {
  it("is noindex in every state, with a title naming the query once there is one", () => {
    expect(searchMetadata(parseSearchRequest({}))).toEqual({ title: "Search", robots: { index: false } });
    expect(searchMetadata(parseSearchRequest({ q: "a" }))).toEqual({ title: "Search", robots: { index: false } });
    expect(searchMetadata(parseSearchRequest({ q: " core  vitals " }))).toEqual({ title: "Results for “core vitals”", robots: { index: false } });
    expect(searchMetadata(parseSearchRequest({ q: "ab", page: "3" }))).toEqual({ title: "Results for “ab”, page 3", robots: { index: false } });
    expect(searchMetadata(parseSearchRequest({ q: "ab", page: "99" }))).toEqual({ title: "Results for “ab”", robots: { index: false } });
  });

  it("makes no request", () => {
    searchMetadata(parseSearchRequest({ q: "ab" }));
    expect(search).not.toHaveBeenCalled();
  });
});

describe("toPageCard", () => {
  const origins = ["https://cms.example"];

  it("gives the page's public path, the link without the CMS origin, in canonical form", () => {
    expect(toPageCard(wpPage(1, "https://cms.example/"), origins)?.href).toBe("/");
    expect(toPageCard(wpPage(1, "https://cms.example/about/team/"), origins)?.href).toBe("/about/team/");
    expect(toPageCard(wpPage(1, "https://cms.example/%E6%97%A5/"), origins)?.href).toBe("/%e6%97%a5/");
  });

  it("is null for a link with no front-end path: another host, a query, a reserved first segment, a dot", () => {
    for (const link of ["https://elsewhere.example/about/", "https://cms.example/?page_id=7", "https://cms.example/about/#team", "https://cms.example/resources/", "https://cms.example/search/", "https://cms.example/a.b/"]) {
      expect(toPageCard(wpPage(1, link), origins), link).toBeNull();
    }
  });

  it("reads the title and the excerpt as plain text, with a name for a blank title", () => {
    const card = toPageCard(wpPage(3, "https://cms.example/about/", { title: { rendered: "A &#8217;s" }, excerpt: { rendered: "<p>One <em>two</em></p>", protected: false } }), origins);
    expect(card).toEqual({ id: 3, title: "A ’s", href: "/about/", summary: "One two" });
    expect(toPageCard(wpPage(3, "https://cms.example/about/", { title: { rendered: "​ " } }), origins)?.title).toBe(UNTITLED_PAGE);
  });
});
