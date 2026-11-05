import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CMS_REVALIDATE_SECONDS,
  CMS_TIMEOUT_MS,
  CmsError,
  NO_SUCH_PAGE,
  scrubCmsHost,
} from "../lib/wp/fetch";
import { resolveSlug } from "../lib/wp/resolve";
import {
  getResourceById,
  getResourceBySlug,
  getResourcesByIds,
  listResources,
  RESOURCES_PER_PAGE,
} from "../lib/wp/resources";
import { getFeaturedFlagId, getTermBySlug, listTerms, MAX_TERM_PAGES } from "../lib/wp/terms";

/**
 * The data layer's requests and its reading of the answers, with `fetch`
 * stubbed: every fetcher's URL, query and tags, the cache options, every
 * error mapping, the timeout, and the rule that no error message names the
 * CMS's origin. Bodies are the captured fixtures in `test/fixtures/wp/`.
 */

const API = "https://cms.example/wp-json";
const HOST = "cms.example";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/wp");
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtures, name), "utf8"));
}
const RESOURCE = fixture("resource.single.json") as { id: number; slug: string };
const RESOURCES = fixture("resources.list.json") as unknown[];
const TYPES = fixture("resource_type.list.json") as { slug: string }[];
const TOPICS = fixture("resource_topic.list.json") as { slug: string }[];
const FLAGS = fixture("resource_flag.list.json") as { slug: string }[];

interface Call {
  readonly url: URL;
  readonly init: RequestInit & { next?: { revalidate?: number; tags?: string[] } };
}

type Handler = (url: URL, init: Call["init"]) => Response | Promise<Response>;

let calls: Call[];
let handler: Handler;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", ...headers },
  });
}

function paged(body: unknown[], total: number, totalPages: number): Response {
  return json(body, 200, { "X-WP-Total": String(total), "X-WP-TotalPages": String(totalPages) });
}

function wpError(status: number, code: string): Response {
  return json({ code, message: `Message mentioning https://${HOST}/wp-json/`, data: { status } }, status);
}

/** The terms whose slug the request's `slug` parameter names, from a captured list. */
function bySlug(list: { slug: string }[], url: URL): Response {
  const slug = url.searchParams.get("slug");
  return paged(
    list.filter((term) => term.slug === slug),
    1,
    1,
  );
}

/** A stand-in CMS over the fixtures, for the paths a test does not override. */
const fixtureCms: Handler = (url) => {
  const route = url.pathname.replace("/wp-json", "");
  if (route === "/wp/v2/resource_type") return bySlug(TYPES, url);
  if (route === "/wp/v2/resource_topic") return bySlug(TOPICS, url);
  if (route === "/wp/v2/resource_flag") return bySlug(FLAGS, url);
  if (route === "/wp/v2/resources") return paged(RESOURCES, 2, 1);
  if (route === `/wp/v2/resources/${RESOURCE.id}`) return json(RESOURCE);
  return wpError(404, "rest_no_route");
};

/** The request's query exactly as sent, without the `?`. */
function query(call: Call): string {
  return call.url.search.slice(1);
}

function only(): Call {
  expect(calls).toHaveLength(1);
  return calls[0];
}

beforeEach(() => {
  vi.stubEnv("WP_API_URL", API);
  vi.stubEnv("WP_MEDIA_ORIGIN", "");
  calls = [];
  handler = fixtureCms;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: Call["init"]) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Runs `run`, expects a `CmsError`, and checks its message never names the CMS. */
async function cmsError(run: () => Promise<unknown>): Promise<CmsError> {
  const error = await run().then(
    () => {
      throw new Error("expected a CmsError");
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CmsError);
  const message = (error as CmsError).message;
  expect(message).not.toMatch(/cms\.example/i);
  expect(message).not.toContain(API);
  expect(String(error)).not.toMatch(/cms\.example/i);
  expect((error as CmsError).cause).toBeUndefined();
  return error as CmsError;
}

describe("the fetch wrapper", () => {
  it("opts into the Data Cache with the tags, the ISR interval and a timeout", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    await getResourceBySlug(RESOURCE.slug);
    const { url, init } = only();
    expect(url.origin + url.pathname).toBe(`${API}/wp/v2/resources`);
    expect(init.cache).toBe("force-cache");
    expect(init.next).toEqual({ revalidate: CMS_REVALIDATE_SECONDS, tags: [`resource:${RESOURCE.slug}`, "terms"] });
    expect(CMS_REVALIDATE_SECONDS).toBe(3600);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(spy).toHaveBeenCalledWith(CMS_TIMEOUT_MS);
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
  });

  it("builds every URL under WP_API_URL, a subdirectory install included", async () => {
    vi.stubEnv("WP_API_URL", "https://example.com/blog/wp-json");
    handler = () => paged([], 0, 0);
    await getResourceBySlug("anything");
    expect(only().url.href).toBe("https://example.com/blog/wp-json/wp/v2/resources?_embed&slug=anything");
  });

  it("times out after CMS_TIMEOUT_MS with a CmsError naming the endpoint", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    handler = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const pending = cmsError(() => getResourceBySlug("slow"));
    controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const error = await pending;
    expect(error.reason).toBe("timeout");
    expect(error.endpoint).toBe("/wp/v2/resources");
    expect(error.message).toBe(`CMS request to /wp/v2/resources failed: no complete answer within ${CMS_TIMEOUT_MS} ms`);
  });

  it("reports a network failure by its code, never by the message that names the address", async () => {
    handler = () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error(`connect ECONNREFUSED ${HOST}:443`), { code: "ECONNREFUSED" }),
      });
    };
    const error = await cmsError(() => listResources({ page: 1 }));
    expect(error.reason).toBe("network");
    expect(error.message).toBe("CMS request to /wp/v2/resources failed: network error ECONNREFUSED");
  });

  it("throws on a 200 that is not JSON", async () => {
    handler = () => new Response(`<html>https://${HOST}/</html>`, { status: 200 });
    const error = await cmsError(() => getResourceBySlug("x"));
    expect(error.reason).toBe("json");
  });

  it("throws on a body the reader schema refuses, naming where without the value", async () => {
    handler = () => json([{ ...(RESOURCE as object), link: `ftp://${HOST}/x` }]);
    const error = await cmsError(() => getResourceBySlug(RESOURCE.slug));
    expect(error.reason).toBe("schema");
    expect(error.message).toContain("0.link: must be an absolute http or https URL");
  });

  it("throws on any status the fetcher did not name, with core's code when it has one", async () => {
    handler = () => wpError(500, "internal_server_error");
    let error = await cmsError(() => listResources({ page: 1 }));
    expect(error.reason).toBe("status");
    expect(error.status).toBe(500);
    expect(error.message).toBe("CMS request to /wp/v2/resources failed: HTTP 500 (internal_server_error)");

    handler = () => new Response(`<h1>Bad gateway at ${HOST}</h1>`, { status: 502 });
    error = await cmsError(() => listResources({ page: 1 }));
    expect(error.message).toBe("CMS request to /wp/v2/resources failed: HTTP 502");
  });

  it("does not treat a 404 for a missing route as a miss", async () => {
    handler = () => wpError(404, "rest_no_route");
    expect((await cmsError(() => getResourceById(15))).status).toBe(404);
    expect((await cmsError(() => resolveSlug("example"))).status).toBe(404);
    expect((await cmsError(() => listResources({ page: 1 }))).status).toBe(404);
  });

  it("throws when the pagination headers are missing", async () => {
    handler = () => json(RESOURCES);
    const error = await cmsError(() => listResources({ page: 1 }));
    expect(error.reason).toBe("schema");
    expect(error.message).toContain("X-WP-Total");
  });

  it("scrubs a configured host from any message, in any case", () => {
    vi.stubEnv("WP_MEDIA_ORIGIN", "https://media.example:8443");
    expect(scrubCmsHost("at https://CMS.example/x and media.example:8443/y")).toBe("at https://[cms]/x and [cms]/y");
  });

  it("scrubs the hostname without the port too, for the API and the media origin", () => {
    vi.stubEnv("WP_API_URL", "https://cms.example:8443/wp-json");
    vi.stubEnv("WP_MEDIA_ORIGIN", "https://media.example:9443");
    expect(scrubCmsHost("http://cms.example/x, https://CMS.EXAMPLE:8443/y, cms.example:80/z")).toBe(
      "http://[cms]/x, https://[cms]/y, [cms]:80/z",
    );
    expect(scrubCmsHost("http://media.example/a and media.example:9443/b")).toBe("http://[cms]/a and [cms]/b");
  });

  it("never follows a redirect, and names it plainly", async () => {
    handler = () => {
      throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    };
    const error = await cmsError(() => getResourceBySlug("moved"));
    expect(only().init.redirect).toBe("error");
    expect(error.reason).toBe("redirect");
    expect(error.message).toBe(
      "CMS request to /wp/v2/resources failed: the CMS answered with a redirect; check WP_API_URL",
    );
  });

  it("treats a 3xx that reaches the reader as a redirect, not a miss", async () => {
    handler = () => new Response(null, { status: 301 });
    let error = await cmsError(() => getResourceById(15));
    expect(error.reason).toBe("redirect");
    expect(error.status).toBe(301);
    expect(error.message).toBe(
      "CMS request to /wp/v2/resources/15 failed: the CMS answered with a redirect (HTTP 301); check WP_API_URL",
    );
    handler = () => wpError(307, "rest_post_invalid_id");
    error = await cmsError(() => getResourceById(15));
    expect(error.reason).toBe("redirect");
  });

  it("refuses a real redirect from Node's fetch with the same reason", async () => {
    vi.unstubAllGlobals();
    const server = createServer((_request, response) => {
      response.writeHead(301, { Location: "https://cms.example/wp-json/wp/v2/resources" });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      vi.stubEnv("WP_API_URL", `http://127.0.0.1:${port}/wp-json`);
      const error = await cmsError(() => getResourceBySlug("moved"));
      expect(error.reason).toBe("redirect");
      expect(error.message).not.toContain("127.0.0.1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("listResources", () => {
  it("reads page 1 of the library with the library's tags", async () => {
    const listing = await listResources({ page: 1 });
    const call = only();
    expect(call.url.pathname).toBe("/wp-json/wp/v2/resources");
    expect(query(call)).toBe(`_embed&per_page=${RESOURCES_PER_PAGE}&page=1`);
    expect(call.init.next?.tags).toEqual(["resources", "terms"]);
    expect(listing).toMatchObject({ total: 2, totalPages: 1 });
    expect(listing !== null && listing !== NO_SUCH_PAGE && listing.items.map((item) => item.slug)).toEqual([
      "a-field-guide-to-revalidation",
      "alt-text-at-scale",
    ]);
  });

  it("resolves the type and topic slugs to IDs first, each lookup with its own tag", async () => {
    handler = (url) => (url.pathname.endsWith("/resources") ? paged(RESOURCES, 14, 2) : fixtureCms(url, {}));
    const listing = await listResources({ type: "Webinar", topic: "performance", page: 2 });
    expect(calls).toHaveLength(3);
    const [typeLookup, topicLookup, list] = calls;
    expect(typeLookup.url.pathname).toBe("/wp-json/wp/v2/resource_type");
    expect(query(typeLookup)).toBe("slug=webinar");
    expect(typeLookup.init.next?.tags).toEqual(["type:webinar"]);
    expect(topicLookup.url.pathname).toBe("/wp-json/wp/v2/resource_topic");
    expect(query(topicLookup)).toBe("slug=performance");
    expect(topicLookup.init.next?.tags).toEqual(["topic:performance"]);
    expect(query(list)).toBe(`_embed&per_page=${RESOURCES_PER_PAGE}&page=2&resource_topic=11&resource_type=5`);
    expect(list.init.next?.tags).toEqual(["type:webinar", "topic:performance", "terms"]);
    expect(listing).toMatchObject({ total: 14, totalPages: 2 });
  });

  it("filters by a flag, with the flag lookup's and the flag listing's tags", async () => {
    await listResources({ flag: "featured", page: 1 });
    const [lookup, list] = calls;
    expect(lookup.url.pathname).toBe("/wp-json/wp/v2/resource_flag");
    expect(query(lookup)).toBe("slug=featured");
    expect(lookup.init.next?.tags).toEqual(["resources"]);
    expect(query(list)).toBe(`_embed&per_page=${RESOURCES_PER_PAGE}&page=1&resource_flag=2`);
    expect(list.init.next?.tags).toEqual(["resources", "terms"]);
  });

  it("is null for an unknown term, without reading the list", async () => {
    expect(await listResources({ type: "no-such-type", page: 1 })).toBeNull();
    expect(await listResources({ topic: "no-such-topic", page: 1 })).toBeNull();
    expect(calls.map((call) => call.url.pathname)).not.toContain("/wp-json/wp/v2/resources");
  });

  it("is null for a slug that cannot be one, without a request", async () => {
    expect(await listResources({ type: "page", page: 1 })).toBeNull();
    expect(await listResources({ type: "Topic", page: 1 })).toBeNull();
    expect(await listResources({ topic: "a b", page: 1 })).toBeNull();
    expect(await listResources({ flag: "", page: 1 })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("is NO_SUCH_PAGE for a page that is not a page number, without a request", async () => {
    for (const page of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      expect(await listResources({ page })).toBe(NO_SUCH_PAGE);
    }
    expect(calls).toHaveLength(0);
  });

  it("is NO_SUCH_PAGE for core's 400 for a page past the end", async () => {
    handler = () => wpError(400, "rest_post_invalid_page_number");
    expect(await listResources({ page: 9 })).toBe(NO_SUCH_PAGE);
  });

  it("throws on any other 400", async () => {
    handler = () => wpError(400, "rest_invalid_param");
    expect((await cmsError(() => listResources({ page: 1 }))).status).toBe(400);
  });

  it("is NO_SUCH_PAGE past the first page of an empty listing, and an empty listing on page 1", async () => {
    handler = () => paged([], 0, 0);
    expect(await listResources({ page: 2 })).toBe(NO_SUCH_PAGE);
    expect(await listResources({ page: 1 })).toEqual({ items: [], total: 0, totalPages: 0 });
  });
});

describe("getResourceBySlug", () => {
  it("canonicalises the slug and tags the read, a miss included", async () => {
    handler = () => paged([], 0, 0);
    expect(await getResourceBySlug("Mixed-Case")).toBeNull();
    const call = only();
    expect(query(call)).toBe("_embed&slug=mixed-case");
    expect(call.init.next?.tags).toEqual(["resource:mixed-case", "terms"]);
  });

  it("sends a non-ASCII slug in WordPress's stored form", async () => {
    handler = () => paged([], 0, 0);
    await getResourceBySlug("日");
    const call = only();
    // The query value is `%e6%97%a5`, the stored `post_name`, encoded once more for the URL.
    expect(call.url.searchParams.get("slug")).toBe("%e6%97%a5");
    expect(call.init.next?.tags).toEqual(["resource:%e6%97%a5", "terms"]);
  });

  it("returns the resource whose slug matches", async () => {
    handler = () => paged([RESOURCE], 1, 1);
    expect((await getResourceBySlug(RESOURCE.slug))?.id).toBe(RESOURCE.id);
  });

  it("throws when the CMS lists resources but none with the slug, and finds the match among others", async () => {
    handler = () => paged([RESOURCE], 1, 1);
    const error = await cmsError(() => getResourceBySlug("another-slug"));
    expect(error.reason).toBe("schema");
    expect(error.message).toBe(
      "CMS request to /wp/v2/resources failed: the body lists resources, none with the slug asked for",
    );
    handler = () => paged(RESOURCES, 2, 1);
    expect((await getResourceBySlug(RESOURCE.slug))?.id).toBe(RESOURCE.id);
  });

  it("is null for an invalid slug, without a request", async () => {
    for (const slug of ["", "a/b", "a b", "..", "\ud800"]) {
      expect(await getResourceBySlug(slug)).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });
});

describe("getResourceById", () => {
  it("reads one resource by ID with the by-ID tags", async () => {
    expect((await getResourceById(RESOURCE.id))?.slug).toBe(RESOURCE.slug);
    const call = only();
    expect(call.url.pathname).toBe(`/wp-json/wp/v2/resources/${RESOURCE.id}`);
    expect(query(call)).toBe("_embed");
    expect(call.init.next?.tags).toEqual(["resources", "terms"]);
  });

  it("is null for core's 404 for no such post and its 401 for an unpublished one", async () => {
    handler = () => wpError(404, "rest_post_invalid_id");
    expect(await getResourceById(99)).toBeNull();
    handler = () => wpError(401, "rest_forbidden");
    expect(await getResourceById(99)).toBeNull();
  });

  it("throws on a 401 that is not core's answer for an unpublished post", async () => {
    handler = () => wpError(401, "rest_not_logged_in");
    expect((await cmsError(() => getResourceById(99))).status).toBe(401);
  });

  it("throws when the body is another resource", async () => {
    handler = () => json(RESOURCE);
    expect((await cmsError(() => getResourceById(RESOURCE.id + 1))).reason).toBe("schema");
  });

  it("is null for a value that is not an ID, without a request", async () => {
    for (const id of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      expect(await getResourceById(id)).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });
});

describe("getResourcesByIds", () => {
  it("reads the IDs in order, once each, with the related section's tags", async () => {
    handler = () => paged(RESOURCES, 2, 1);
    const items = await getResourcesByIds([40, 15, 40], { hostSlug: "Host-Page" });
    const call = only();
    expect(query(call)).toBe("_embed&include=40,15&orderby=include&per_page=2");
    expect(call.init.next?.tags).toEqual(["resources", "terms", "resource:host-page"]);
    // Only the requested IDs come back; the fixture's other resource is dropped.
    expect(items.map((item) => item.id)).toEqual([15]);
  });

  it("returns an empty list for no IDs, without a request", async () => {
    expect(await getResourcesByIds([], { hostSlug: "host" })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("throws a RangeError on a bad ID, too many IDs or a bad host slug", async () => {
    await expect(getResourcesByIds([0], { hostSlug: "host" })).rejects.toThrow(RangeError);
    await expect(getResourcesByIds([1.5], { hostSlug: "host" })).rejects.toThrow(RangeError);
    const many = Array.from({ length: 101 }, (_, index) => index + 1);
    await expect(getResourcesByIds(many, { hostSlug: "host" })).rejects.toThrow(RangeError);
    await expect(getResourcesByIds([1], { hostSlug: "" })).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });
});

describe("terms", () => {
  it("lists a taxonomy a hundred at a time, every page, with the filter bar's tags", async () => {
    handler = (url) =>
      url.searchParams.get("page") === "1" ? paged(TOPICS.slice(0, 3), 5, 2) : paged(TOPICS.slice(3), 5, 2);
    const terms = await listTerms("resource_topic");
    expect(terms.map((term) => term.slug)).toEqual(TOPICS.map((term) => term.slug));
    expect(calls.map(query)).toEqual([
      "per_page=100&page=1&orderby=name&order=asc",
      "per_page=100&page=2&orderby=name&order=asc",
    ]);
    for (const call of calls) {
      expect(call.url.pathname).toBe("/wp-json/wp/v2/resource_topic");
      expect(call.init.next?.tags).toEqual(["resources", "terms"]);
    }
  });

  describe(`past ${MAX_TERM_PAGES} pages`, () => {
    const TEMPLATE = TOPICS[0] as Record<string, unknown>;
    /** A topic collection of `total` terms, served a hundred at a time. */
    function manyTerms(total: number): Handler {
      const totalPages = Math.ceil(total / 100);
      return (url) => {
        const page = Number(url.searchParams.get("page"));
        const from = (page - 1) * 100;
        const terms = Array.from({ length: Math.max(0, Math.min(100, total - from)) }, (_, index) => ({
          ...TEMPLATE,
          id: 1000 + from + index,
          slug: `topic-${from + index}`,
          name: `Topic ${from + index}`,
        }));
        return paged(terms, total, totalPages);
      };
    }

    it("returns exactly 1,000 terms without a warning", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      handler = manyTerms(1000);
      expect(await listTerms("resource_topic")).toHaveLength(1000);
      expect(calls).toHaveLength(MAX_TERM_PAGES);
      expect(warn).not.toHaveBeenCalled();
    });

    it("returns the first 1,000 of 1,001 and warns, naming the taxonomy but not the CMS", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      handler = manyTerms(1001);
      const terms = await listTerms("resource_topic");
      expect(terms).toHaveLength(1000);
      expect(terms.at(-1)?.slug).toBe("topic-999");
      expect(calls).toHaveLength(MAX_TERM_PAGES);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain("resource_topic");
      expect(message).toContain("1000");
      expect(message).not.toMatch(/cms\.example|wp-json/i);
    });
  });

  it("throws when a listed term is in another taxonomy", async () => {
    handler = () => paged(TYPES, 5, 1);
    expect((await cmsError(() => listTerms("resource_topic"))).reason).toBe("schema");
  });

  it("looks up a term by its canonical slug, a miss tagged too", async () => {
    expect((await getTermBySlug("resource_type", "WEBINAR"))?.id).toBe(5);
    expect(await getTermBySlug("resource_topic", "nothing-here")).toBeNull();
    expect(calls.map(query)).toEqual(["slug=webinar", "slug=nothing-here"]);
    expect(calls.map((call) => call.init.next?.tags)).toEqual([["type:webinar"], ["topic:nothing-here"]]);
  });

  it("is null for a slug that cannot be the term's, without a request", async () => {
    expect(await getTermBySlug("resource_type", "page")).toBeNull();
    expect(await getTermBySlug("resource_topic", "a/b")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("finds the featured flag's ID with the flag lookup's tags", async () => {
    expect(await getFeaturedFlagId()).toBe(2);
    const call = only();
    expect(call.url.pathname).toBe("/wp-json/wp/v2/resource_flag");
    expect(query(call)).toBe("slug=featured");
    expect(call.init.next?.tags).toEqual(["resources"]);

    handler = () => paged([], 0, 0);
    expect(await getFeaturedFlagId()).toBeNull();
  });
});

describe("resolveSlug", () => {
  it("asks the plugin's resolve route for the canonical slug, with the resolve tags", async () => {
    handler = () => json({ id: 15, type: "ebook", slug: "a-field-guide-to-revalidation" });
    expect(await resolveSlug("Old-Slug")).toEqual({ id: 15, type: "ebook", slug: "a-field-guide-to-revalidation" });
    const call = only();
    expect(call.url.pathname).toBe("/wp-json/resource-hub/v1/resolve");
    expect(query(call)).toBe("slug=old-slug");
    expect(call.init.next?.tags).toEqual(["resources"]);
  });

  it("is null for the plugin's 404, and throws on its 400", async () => {
    handler = () => wpError(404, "resource_hub_not_found");
    expect(await resolveSlug("gone")).toBeNull();
    handler = () => wpError(400, "rest_invalid_param");
    expect((await cmsError(() => resolveSlug("refused"))).status).toBe(400);
  });

  it("is null for an invalid slug, without a request", async () => {
    expect(await resolveSlug("a b")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("throws on a body the reader schema refuses", async () => {
    handler = () => json({ id: 15, type: "page", slug: "x" });
    expect((await cmsError(() => resolveSlug("x"))).reason).toBe("schema");
  });
});
