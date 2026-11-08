import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CmsError } from "../lib/wp/fetch";
import { MAX_SEARCH_PAGE, SEARCH_PER_PAGE } from "../lib/wp/schemas/search";
import {
  MAX_SEARCH_QUERY_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
  normalizeSearchQuery,
  searchQuery,
  searchSite,
} from "../lib/wp/search";

/**
 * The search reader (issue #115) with `fetch` stubbed: the route's URL and
 * query, the tags and cache options on all three fetches, the per-kind
 * `include=` reads and the order the hits come back in, what a CMS without
 * the route and every other answer come back as, and the query rules, which
 * mirror the plugin's `SearchRoute::normalize_query()` code point by code
 * point.
 */

const API = "https://cms.example/wp-json";
const here = path.dirname(fileURLToPath(import.meta.url));

interface Call {
  readonly url: URL;
  readonly init: RequestInit & { next?: { revalidate?: number; tags?: string[] } };
}

let calls: Call[];
let handler: (url: URL) => Response;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=UTF-8", ...headers } });
}

function wpError(status: number, code: string): Response {
  return json({ code, message: "Mentions https://cms.example/wp-json/", data: { status } }, status);
}

/** A collection answer with core's pagination headers. */
function list(items: unknown[]): Response {
  return json(items, 200, { "X-WP-Total": String(items.length), "X-WP-TotalPages": "1" });
}

/** Two real resources, IDs 15 and 14, as core serialises them with `_embed`. */
const RESOURCES = JSON.parse(readFileSync(path.join(here, "fixtures/wp/resources.list.json"), "utf8")) as { id: number }[];

function page(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `page-${id}`,
    link: `https://cms.example/page-${id}/`,
    parent: 0,
    date_gmt: "2026-11-01T09:00:00",
    modified_gmt: "2026-11-02T10:00:00",
    title: { rendered: `Page ${id}` },
    content: { rendered: "<p>Body.</p>", protected: false },
    excerpt: { rendered: "<p>Summary.</p>\n", protected: false },
    ...overrides,
  };
}

const ROUTE_ANSWER = {
  items: [
    { id: 15, type: "resource" },
    { id: 7, type: "page" },
    { id: 14, type: "resource" },
    { id: 8, type: "page" },
  ],
  total: 30,
  pages: 3,
};

/** The route answers `route`; the collections answer what they hold of `resources` and `pages` for the IDs asked. */
function cms(route: unknown, pages: Record<string, unknown>[] = [page(7), page(8)]): (url: URL) => Response {
  return (url) => {
    if (url.pathname === "/wp-json/resource-hub/v1/search") {
      return json(route);
    }
    const include = (url.searchParams.get("include") ?? "").split(",").map(Number);
    if (url.pathname === "/wp-json/wp/v2/resources") {
      return list(RESOURCES.filter((resource) => include.includes(resource.id)));
    }
    if (url.pathname === "/wp-json/wp/v2/pages") {
      return list(pages.filter((wpPage) => include.includes(wpPage.id as number)));
    }
    return wpError(404, "rest_no_route");
  };
}

function callTo(pathname: string): Call {
  const found = calls.filter((call) => call.url.pathname === `/wp-json${pathname}`);
  expect(found, pathname).toHaveLength(1);
  return found[0];
}

beforeEach(() => {
  vi.stubEnv("WP_API_URL", API);
  vi.stubEnv("WP_MEDIA_ORIGIN", "");
  calls = [];
  handler = () => wpError(404, "rest_no_route");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: Call["init"]) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return handler(url);
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function cmsError(run: () => Promise<unknown>): Promise<CmsError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CmsError) return error;
    throw error;
  }
  throw new Error("expected a CmsError");
}

describe("normalizeSearchQuery", () => {
  it("collapses every run of whitespace to one space and trims the ends, and changes nothing else", () => {
    expect(normalizeSearchQuery("case study")).toBe("case study");
    expect(normalizeSearchQuery("  case study\t")).toBe("case study");
    expect(normalizeSearchQuery("case \t\n\r\v\f study")).toBe("case study");
    expect(normalizeSearchQuery("\u3000case\u3000\u2003study\u3000")).toBe("case study");
    expect(normalizeSearchQuery("Case <b>Study</b>")).toBe("Case <b>Study</b>");
    expect(normalizeSearchQuery("日本語")).toBe("日本語");
    expect(normalizeSearchQuery(" \t ")).toBe("");
  });

  it("counts as whitespace exactly what the plugin's PCRE \\s with the u flag does", () => {
    // Read off PHP 8.4 in wp-env on 2026-11-08: preg_match('/\s/u', mb_chr($c)) for each code point.
    const pcre: Record<number, boolean> = {
      0x0085: true,
      0x00a0: true,
      0x1680: true,
      0x180e: true,
      0x2000: true,
      0x200a: true,
      0x200b: false,
      0x2028: true,
      0x202f: true,
      0x205f: true,
      0x3000: true,
      0xfeff: false,
    };
    for (const [codePoint, isSpace] of Object.entries(pcre)) {
      const char = String.fromCodePoint(Number(codePoint));
      expect(normalizeSearchQuery(`a${char}b`), `U+${Number(codePoint).toString(16)}`).toBe(isSpace ? "a b" : `a${char}b`);
    }
  });
});

describe("searchQuery", () => {
  it("is the normalised query when it is 2 to 100 code points, else null", () => {
    expect(MIN_SEARCH_QUERY_LENGTH).toBe(2);
    expect(MAX_SEARCH_QUERY_LENGTH).toBe(100);
    expect(searchQuery("ab")).toBe("ab");
    expect(searchQuery("   ab   ")).toBe("ab");
    expect(searchQuery("é".repeat(100))).toBe("é".repeat(100));
    expect(searchQuery("😀".repeat(100))).toBe("😀".repeat(100));
    expect(searchQuery(`${"a".repeat(50)}${" ".repeat(300)}${"b".repeat(49)}`)).toBe(`${"a".repeat(50)} ${"b".repeat(49)}`);
    expect(searchQuery("")).toBeNull();
    expect(searchQuery("a")).toBeNull();
    expect(searchQuery("  a  ")).toBeNull();
    expect(searchQuery(" \t\u3000 ")).toBeNull();
    expect(searchQuery("a".repeat(101))).toBeNull();
    expect(searchQuery("😀".repeat(101))).toBeNull();
    expect(searchQuery(`${"a ".repeat(50)}a`)).toBeNull();
  });
});

describe("searchSite", () => {
  it("asks the search route for the query and page, then reads each kind by ID, all tagged resources, terms and pages", async () => {
    handler = cms(ROUTE_ANSWER);
    const results = await searchSite("case study", 2);
    expect(calls).toHaveLength(3);

    const route = callTo("/resource-hub/v1/search");
    expect(route.url.href).toBe(`${API}/resource-hub/v1/search?q=case+study&page=2`);
    const resources = callTo("/wp/v2/resources");
    expect(resources.url.search).toBe("?_embed&include=15,14&orderby=include&per_page=2");
    const pages = callTo("/wp/v2/pages");
    expect(pages.url.search).toBe("?include=7,8&orderby=include&per_page=2");
    for (const call of [route, resources, pages]) {
      expect(call.init.next).toEqual({ revalidate: 3600, tags: ["resources", "terms", "pages"] });
      expect(call.init.cache).toBe("force-cache");
      expect(call.init.redirect).toBe("error");
    }

    expect(results).not.toBeNull();
    expect(results?.total).toBe(30);
    expect(results?.pages).toBe(3);
    expect(results?.items.map((hit) => [hit.type, hit.type === "resource" ? hit.resource.id : hit.page.id])).toEqual([
      ["resource", 15],
      ["page", 7],
      ["resource", 14],
      ["page", 8],
    ]);
  });

  it("asks for the first page when none is given", async () => {
    handler = cms({ items: [], total: 0, pages: 0 });
    expect(await searchSite("webinar")).toEqual({ items: [], total: 0, pages: 0 });
    expect(callTo("/resource-hub/v1/search").url.search).toBe("?q=webinar&page=1");
  });

  it("makes no collection read for a kind with no matches, and none at all for no matches", async () => {
    handler = cms({ items: [{ id: 7, type: "page" }], total: 1, pages: 1 });
    const results = await searchSite("about us");
    expect(calls.map((call) => call.url.pathname)).toEqual(["/wp-json/resource-hub/v1/search", "/wp-json/wp/v2/pages"]);
    expect(results?.items).toHaveLength(1);

    calls = [];
    handler = cms({ items: [], total: 0, pages: 0 });
    await searchSite("nothing here");
    expect(calls).toHaveLength(1);
  });

  it("encodes the query as a search parameter, whatever it holds", async () => {
    handler = cms({ items: [], total: 0, pages: 0 });
    await searchSite("a&b=c #日本");
    const route = callTo("/resource-hub/v1/search");
    expect(route.url.searchParams.get("q")).toBe("a&b=c #日本");
    expect(route.url.searchParams.get("page")).toBe("1");
  });

  it("leaves out a match its collection no longer returns, a protected page and a repeated item, keeping the route's counts", async () => {
    handler = cms(
      {
        items: [
          { id: 99, type: "resource" },
          { id: 15, type: "resource" },
          { id: 7, type: "page" },
          { id: 15, type: "resource" },
          { id: 8, type: "page" },
        ],
        total: 5,
        pages: 1,
      },
      [page(7, { content: { rendered: "", protected: true } }), page(8)],
    );
    const results = await searchSite("case study");
    expect(results?.items.map((hit) => [hit.type, hit.type === "resource" ? hit.resource.id : hit.page.id])).toEqual([
      ["resource", 15],
      ["page", 8],
    ]);
    expect(results?.total).toBe(5);
  });

  it("drops a key it does not know, at either level", async () => {
    handler = cms({ items: [{ id: 15, type: "resource", score: 2 }], total: 1, pages: 1, engine: "relevanssi" });
    const results = await searchSite("case study");
    expect(results).toEqual({ items: [{ type: "resource", resource: expect.objectContaining({ id: 15 }) }], total: 1, pages: 1 });
  });

  it("is null for core's rest_no_route, which a CMS without the route answers, asks nothing else, and warns once per process", async () => {
    vi.resetModules();
    const { searchSite: freshSearchSite } = await import("../lib/wp/search");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handler = () => wpError(404, "rest_no_route");
    expect(await freshSearchSite("case study")).toBeNull();
    expect(await freshSearchSite("webinar")).toBeNull();
    expect(calls).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/^searchSite: \/resource-hub\/v1\/search answered rest_no_route/);
    expect(String(warn.mock.calls[0][0])).not.toContain("cms.example");
  });

  it("throws a CmsError, naming no CMS host, on any other answer: a 400, a 500, another 404, a body that is not JSON", async () => {
    const answers = [
      () => wpError(400, "rest_invalid_param"),
      () => wpError(500, "internal_server_error"),
      () => wpError(404, "resource_hub_not_found"),
      () => new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    ];
    for (const answer of answers) {
      handler = answer;
      const error = await cmsError(() => searchSite("case study"));
      expect(error.message).not.toContain("cms.example");
    }
  });

  it("throws a CmsError when the body fails the reader schema: an unknown kind, too many items, too many pages", async () => {
    const bodies = [
      { items: [{ id: 5, type: "post" }], total: 1, pages: 1 },
      { items: Array.from({ length: SEARCH_PER_PAGE + 1 }, (_, index) => ({ id: index + 1, type: "resource" })), total: 13, pages: 2 },
      { items: [], total: 500, pages: MAX_SEARCH_PAGE + 1 },
      { items: [], pages: 0 },
    ];
    for (const body of bodies) {
      handler = () => json(body);
      expect((await cmsError(() => searchSite("case study"))).reason).toBe("schema");
    }
  });

  it("throws a RangeError, without a request, on a query that is not normalised or out of bounds, or a bad page", async () => {
    for (const query of ["", "a", " case study", "case  study", "case\u00a0study", "a".repeat(101)]) {
      await expect(searchSite(query)).rejects.toThrow(RangeError);
    }
    for (const page of [0, -1, MAX_SEARCH_PAGE + 1, 1.5, Number.NaN]) {
      await expect(searchSite("case study", page)).rejects.toThrow(RangeError);
    }
    expect(calls).toHaveLength(0);
  });
});
