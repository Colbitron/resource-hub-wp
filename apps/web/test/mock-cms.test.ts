import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { mockCms, type MockCmsClient } from "../e2e/mock-cms/client.mts";
import { startMockCms, type MockCms } from "../e2e/mock-cms/server.mts";
import { parsePaginationHeaders } from "../lib/wp/schemas/pagination";
import { resolveResponseSchemaStrict } from "../lib/wp/schemas/resolve";
import { wpMediaSchema, wpResourceListSchema, wpResourceSchema, wpTermListSchema } from "../lib/wp/schemas/rest";
import { wpErrorSchema } from "../lib/wp/schemas/wp-error";

/**
 * The mock CMS's self-check: every body it serves passes the front end's
 * reader schemas, its pagination and errors are WordPress's, and its
 * control endpoints change what the public routes say. It starts the mock
 * on a free port, so it runs beside the e2e harness without touching 4010.
 */

const NO_CACHE = "no-cache, must-revalidate, max-age=0";
const TAXONOMIES = ["resource_topic", "resource_type", "resource_flag"] as const;

let server: MockCms;
let cms: MockCmsClient;

beforeAll(async () => {
  server = await startMockCms({ port: 0, host: "127.0.0.1" });
  cms = mockCms(server.origin);
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await cms.reset();
});

/** The featured image entries of a list, parsed strictly: a usable image or nothing, never a silent `null`. */
function featuredMedia(resources: unknown[]) {
  return resources.flatMap((resource) => {
    const embedded = (resource as { _embedded?: { "wp:featuredmedia"?: unknown[] } })._embedded;
    return embedded?.["wp:featuredmedia"] ?? [];
  });
}

describe("GET /wp/v2/resources", () => {
  it("serves a first page that the reader schema accepts, with WordPress's headers", async () => {
    const response = await cms.get<unknown[]>("/wp-json/wp/v2/resources?_embed");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(NO_CACHE);
    expect(response.headers.get("content-type")).toBe("application/json; charset=UTF-8");

    const pagination = parsePaginationHeaders(response.headers);
    expect(pagination.total).toBe(14);
    expect(pagination.totalPages).toBe(2);
    expect(response.body).toHaveLength(10);

    const parsed = wpResourceListSchema.parse(response.body);
    for (const media of featuredMedia(response.body)) {
      expect(() => wpMediaSchema.parse(media)).not.toThrow();
    }
    // Newest first.
    const dates = parsed.map((r) => r.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("has more than one page at the default per_page, a resource with no image and one with an SVG", async () => {
    const all = await cms.get<unknown[]>("/wp-json/wp/v2/resources?_embed&per_page=100");
    const parsed = wpResourceListSchema.parse(all.body);
    expect(parsed.length).toBeGreaterThan(10);
    expect(parsed.some((r) => r._embedded["wp:featuredmedia"].length === 0)).toBe(true);
    const svg = parsed.find((r) => r._embedded["wp:featuredmedia"][0]?.source_url.endsWith(".svg"));
    expect(svg?._embedded["wp:featuredmedia"][0]?.media_details).toEqual({ sizes: {} });
    const sized = parsed.find((r) => Object.keys(r._embedded["wp:featuredmedia"][0]?.media_details.sizes ?? {}).length > 0);
    expect(sized).toBeDefined();
    for (const term of TAXONOMIES) {
      const ids = new Set(parsed.flatMap((r) => r[term]));
      expect(ids.size).toBeGreaterThan(0);
    }
  });

  it("serves page 2 and answers a page past the end with core's 400", async () => {
    const second = await cms.get<unknown[]>("/wp-json/wp/v2/resources?_embed&page=2");
    expect(second.status).toBe(200);
    expect(wpResourceListSchema.parse(second.body)).toHaveLength(4);
    expect(second.headers.get("link")).toContain('rel="prev"');

    const third = await cms.get("/wp-json/wp/v2/resources?_embed&page=3");
    expect(third.status).toBe(400);
    expect(wpErrorSchema.parse(third.body)).toMatchObject({ code: "rest_post_invalid_page_number", data: { status: 400 } });
  });

  it("rejects a per_page out of range with core's rest_invalid_param", async () => {
    const response = await cms.get("/wp-json/wp/v2/resources?per_page=101");
    expect(response.status).toBe(400);
    expect(wpErrorSchema.parse(response.body)).toMatchObject({ code: "rest_invalid_param", data: { status: 400 } });
  });

  it("filters by slug, by term IDs, and by include in the order given", async () => {
    const bySlug = await cms.get<unknown[]>("/wp-json/wp/v2/resources?_embed&slug=cache-tags-explained");
    expect(wpResourceListSchema.parse(bySlug.body).map((r) => r.slug)).toEqual(["cache-tags-explained"]);

    // Type 4 is ebook, topic 12 is accessibility: one resource has both.
    const byTerms = await cms.get<unknown[]>("/wp-json/wp/v2/resources?_embed&resource_type=4&resource_topic=12");
    const parsed = wpResourceListSchema.parse(byTerms.body);
    expect(parsed.map((r) => r.slug)).toEqual(["an-accessibility-audit-in-a-day"]);
    expect(parsePaginationHeaders(byTerms.headers)).toEqual({ total: 1, totalPages: 1 });

    const featured = await cms.get<unknown[]>("/wp-json/wp/v2/resources?_embed&resource_flag=2");
    expect(wpResourceListSchema.parse(featured.body).every((r) => r.resource_flag.includes(2))).toBe(true);

    const included = await cms.get<unknown[]>("/wp-json/wp/v2/resources?_embed&include=27,20,33&orderby=include");
    expect(wpResourceListSchema.parse(included.body).map((r) => r.id)).toEqual([27, 20, 33]);
  });

  it("leaves _embedded out without _embed, as core does", async () => {
    const response = await cms.get<Record<string, unknown>[]>("/wp-json/wp/v2/resources?per_page=1");
    expect(response.body[0]).not.toHaveProperty("_embedded");
  });

  it("builds every absolute URL on its own origin", async () => {
    const response = await cms.get<unknown[]>("/wp-json/wp/v2/resources?_embed&per_page=100");
    const text = JSON.stringify(response.body);
    const urls = text.match(/https?:\/\/[^"\s\\]+/g) ?? [];
    const foreign = urls.filter((url) => !url.startsWith(server.origin) && !url.startsWith("https://api.w.org/") && !url.startsWith("https://example.com/"));
    expect(foreign).toEqual([]);
  });
});

describe("GET /wp/v2/resources/{id}", () => {
  it("serves a published resource with its embeds", async () => {
    const response = await cms.get("/wp-json/wp/v2/resources/33?_embed");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(NO_CACHE);
    const parsed = wpResourceSchema.parse(response.body);
    expect(parsed.slug).toBe("revalidation-from-the-editors-chair");
    expect(parsed.content.rendered).toContain('data-rh-block="related-resources"');
    expect(parsed.content.rendered).toContain('data-topic="editorial-workflow"');
    expect(parsed.content.rendered).toContain(`${server.origin}/wp-content/uploads/`);
  });

  it("answers an unknown ID with core's 404 and an unpublished one with core's 401", async () => {
    const missing = await cms.get("/wp-json/wp/v2/resources/9999");
    expect(missing.status).toBe(404);
    expect(wpErrorSchema.parse(missing.body).code).toBe("rest_post_invalid_id");

    await cms.setStatus(21, "draft");
    const draft = await cms.get("/wp-json/wp/v2/resources/21");
    expect(draft.status).toBe(401);
    expect(wpErrorSchema.parse(draft.body).code).toBe("rest_forbidden");
  });
});

describe("the taxonomy endpoints", () => {
  for (const taxonomy of TAXONOMIES) {
    it(`GET /wp/v2/${taxonomy} passes the term schema and counts published resources`, async () => {
      const response = await cms.get<unknown[]>(`/wp-json/wp/v2/${taxonomy}?per_page=100`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(NO_CACHE);
      const terms = wpTermListSchema.parse(response.body);
      expect(terms.length).toBeGreaterThan(0);
      expect(terms.every((term) => term.taxonomy === taxonomy)).toBe(true);
      expect(parsePaginationHeaders(response.headers).total).toBe(terms.length);
      for (const term of terms) {
        const withTerm = await cms.get<unknown[]>(`/wp-json/wp/v2/resources?${taxonomy}=${term.id}&per_page=100`);
        expect(withTerm.body).toHaveLength(term.count);
      }
    });
  }

  it("filters terms by slug and pages them", async () => {
    const bySlug = await cms.get<unknown[]>("/wp-json/wp/v2/resource_topic?slug=performance");
    expect(wpTermListSchema.parse(bySlug.body).map((t) => t.id)).toEqual([11]);

    const page = await cms.get<unknown[]>("/wp-json/wp/v2/resource_type?per_page=2&page=2");
    expect(wpTermListSchema.parse(page.body)).toHaveLength(2);
    expect(parsePaginationHeaders(page.headers)).toEqual({ total: 5, totalPages: 3 });

    // Unlike the posts controller, core's terms controller has no page-number check.
    const past = await cms.get<unknown[]>("/wp-json/wp/v2/resource_type?per_page=2&page=4");
    expect(past.status).toBe(200);
    expect(past.body).toEqual([]);
    expect(parsePaginationHeaders(past.headers)).toEqual({ total: 5, totalPages: 3 });
    const farPast = await cms.get<unknown[]>("/wp-json/wp/v2/resource_type?per_page=2&page=9");
    expect(farPast.body).toEqual([]);
    // Core clamps `prev` to the last page.
    expect(farPast.headers.get("link")).toMatch(/[?&]page=3>; rel="prev"$/);
  });
});

describe("GET /resource-hub/v1/resolve", () => {
  it("answers a current slug with the strict contract shape", async () => {
    const response = await cms.resolve("cache-tags-explained");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(NO_CACHE);
    expect(resolveResponseSchemaStrict.parse(response.body)).toEqual({ id: 27, type: "ebook", slug: "cache-tags-explained" });
  });

  it("answers an old slug with the current identity, and anything else with the plugin's 404", async () => {
    await cms.renameSlug(27, "cache-tags-in-practice");
    expect(resolveResponseSchemaStrict.parse((await cms.resolve("cache-tags-explained")).body).slug).toBe("cache-tags-in-practice");

    const missing = await cms.resolve("no-such-slug");
    expect(missing.status).toBe(404);
    expect(wpErrorSchema.parse(missing.body)).toMatchObject({ code: "resource_hub_not_found", data: { status: 404 } });

    await cms.setStatus(27, "trash");
    expect((await cms.resolve("cache-tags-in-practice")).status).toBe(404);
  });

  it("answers a missing or empty slug with a 400", async () => {
    const missing = await cms.get("/wp-json/resource-hub/v1/resolve");
    expect(missing.status).toBe(400);
    expect(wpErrorSchema.parse(missing.body).code).toBe("rest_missing_callback_param");

    const empty = await cms.resolve("---");
    expect(empty.status).toBe(400);
    expect(wpErrorSchema.parse(empty.body).code).toBe("rest_invalid_param");
  });
});

describe("uploads and everything else", () => {
  it("serves a committed upload byte for byte and refuses to leave the directory", async () => {
    const file = "2026/11/revalidation.png";
    const expected = await readFile(resolve(__dirname, "../e2e/mock-cms/fixtures/uploads", file));
    const response = await fetch(`${server.origin}/wp-content/uploads/${file}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer()).equals(expected)).toBe(true);

    const svg = await fetch(`${server.origin}/wp-content/uploads/2026/11/diagram.svg`);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");

    expect((await fetch(`${server.origin}/wp-content/uploads/2026/11/missing.png`)).status).toBe(404);
    expect((await fetch(`${server.origin}/wp-content/uploads/%2e%2e/%2e%2e/package.json`)).status).toBe(404);
  });

  it("answers a theme page and an unknown REST route with 404s", async () => {
    expect((await fetch(`${server.origin}/resources/ebook/cache-tags-explained/`)).status).toBe(404);
    const rest = await cms.get("/wp-json/wp/v2/posts");
    expect(rest.status).toBe(404);
    expect(wpErrorSchema.parse(rest.body).code).toBe("rest_no_route");
  });
});

describe("the control endpoints", () => {
  it("publishes a new resource that the public routes then serve", async () => {
    const created = await cms.createResource({
      title: "A brand new webinar",
      type: "webinar",
      topics: ["performance"],
      featured: true,
      mediaId: 102,
      summary: "Fresh from the control endpoint.",
    });
    expect(created).toMatchObject({ slug: "a-brand-new-webinar", status: "publish", type: "webinar", topics: ["performance"], featured: true });

    const list = await cms.get<unknown[]>("/wp-json/wp/v2/resources?_embed&per_page=1");
    const [first] = wpResourceListSchema.parse(list.body);
    expect(first.id).toBe(created.id);
    expect(first.resource_type).toEqual([5]);
    expect(first.resource_flag).toEqual([2]);
    expect(first._embedded["wp:featuredmedia"][0]?.source_url).toBe(`${server.origin}/wp-content/uploads/2026/11/revalidation.png`);
    expect(parsePaginationHeaders(list.headers).total).toBe(15);
  });

  it("changes a resource's type and topics", async () => {
    await cms.setType(20, "podcast");
    await cms.setTopics(20, ["accessibility"]);
    const response = await cms.get("/wp-json/wp/v2/resources/20?_embed");
    const parsed = wpResourceSchema.parse(response.body);
    expect(parsed.resource_type).toEqual([6]);
    expect(parsed.resource_topic).toEqual([12]);
    expect(parsed.link).toBe(`${server.origin}/resources/podcast/a-field-guide-to-revalidation/`);
    expect(parsed._embedded["wp:term"].flat().map((t) => t.slug)).toEqual(["accessibility", "podcast", "featured"]);
  });

  it("takes an unpublished or trashed resource out of the listing", async () => {
    await cms.setStatus(20, "draft");
    await cms.setStatus(21, "trash");
    const all = await cms.get<unknown[]>("/wp-json/wp/v2/resources?per_page=100");
    const ids = wpResourceListSchema.parse(all.body).map((r) => r.id);
    expect(ids).not.toContain(20);
    expect(ids).not.toContain(21);
    expect(parsePaginationHeaders(all.headers).total).toBe(12);
  });

  it("renames a term everywhere and deletes one from every resource", async () => {
    const renamed = await cms.renameTerm("resource_topic", 11, { slug: "speed", name: "Speed" });
    expect(renamed).toMatchObject({ id: 11, slug: "speed", name: "Speed" });
    const resource = wpResourceSchema.parse((await cms.get("/wp-json/wp/v2/resources/20?_embed")).body);
    expect(resource._embedded["wp:term"][0].map((t) => t.slug)).toEqual(["headless-delivery", "speed"]);

    await cms.deleteTerm("resource_topic", 11);
    const topics = wpTermListSchema.parse((await cms.get("/wp-json/wp/v2/resource_topic?per_page=100")).body);
    expect(topics.map((t) => t.id)).not.toContain(11);
    const after = wpResourceSchema.parse((await cms.get("/wp-json/wp/v2/resources/20?_embed")).body);
    expect(after.resource_topic).toEqual([9]);
  });

  it("refuses bad input with a 4xx the client throws", async () => {
    await expect(cms.setType(20, "no-such-type")).rejects.toMatchObject({ status: 422 });
    await expect(cms.renameSlug(20, "alt-text-at-scale")).rejects.toMatchObject({ status: 409 });
    await expect(cms.renameSlug(9999, "whatever")).rejects.toMatchObject({ status: 404 });
  });

  it("counts public requests by path and query, never control requests, and resets them", async () => {
    await cms.get("/wp-json/wp/v2/resources?_embed");
    await cms.get("/wp-json/wp/v2/resources?_embed");
    await cms.resolve("cache-tags-explained");
    await cms.state();
    expect(await cms.requests()).toEqual({
      total: 3,
      byPath: {
        "/wp-json/resource-hub/v1/resolve?slug=cache-tags-explained": 1,
        "/wp-json/wp/v2/resources?_embed": 2,
      },
    });
    await cms.resetRequests();
    expect((await cms.requests()).total).toBe(0);
  });
});
