import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { mockCms, type MockCmsClient } from "../e2e/mock-cms/client.mts";
import { slugify } from "../e2e/mock-cms/sanitize.mts";
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

/**
 * The contract's JSON Schemas, compiled with the Ajv that `packages/ui`'s own
 * schema test uses (loaded from that package, as the app does not depend on
 * it). The related route has no Zod reader in the app yet, so its bodies are
 * checked against `related-response.schema.json` directly.
 */
interface AjvValidator {
  (data: unknown): boolean;
  errors?: unknown;
}
interface AjvInstance {
  addSchema(schema: object): AjvInstance;
  getSchema(id: string): AjvValidator | undefined;
}
const uiPackage = resolve(__dirname, "../../../packages/ui");
const requireFromUi = createRequire(join(uiPackage, "package.json"));
const Ajv2020 = (requireFromUi("ajv/dist/2020.js") as { default: new (options: object) => AjvInstance }).default;
const addFormats = (requireFromUi("ajv-formats") as { default: (ajv: AjvInstance) => void }).default;
const contract = new Ajv2020({ strict: true, allErrors: true });
addFormats(contract);
for (const name of readdirSync(join(uiPackage, "schemas")).filter((file) => file.endsWith(".schema.json"))) {
  contract.addSchema(JSON.parse(readFileSync(join(uiPackage, "schemas", name), "utf8")) as object);
}

/** Validates against one contract schema by file name, failing with Ajv's errors. */
function expectContract(schema: string, body: unknown): void {
  const validate = contract.getSchema(
    `https://raw.githubusercontent.com/Colbitron/resource-hub-wp/main/packages/ui/schemas/${schema}.schema.json`,
  );
  if (!validate) throw new Error(`No contract schema named ${schema}`);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
}

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

describe("slugify, the mock's sanitize_title()", () => {
  // Expected values are what WordPress 7.1.4's sanitize_title() returns on an en_US site.
  it.each([
    ["Hello World", "hello-world"],
    ["snake_case_slug", "snake_case_slug"],
    ["Café Déjà Vu", "cafe-deja-vu"],
    ["Ñandú über Ångström", "nandu-uber-angstrom"],
    ["Straße", "strase"],
    ["Œuvre & Æsthetics", "oeuvre-aesthetics"],
    ["Revalidation from the editor’s chair", "revalidation-from-the-editors-chair"],
    ["“Quoted” — and dashed", "quoted-and-dashed"],
    ["1/2 cup, v1.2", "1-2-cup-v1-2"],
    ["  --multiple---dashes--  ", "multiple-dashes"],
    ["<b>Bold</b> move", "bold-move"],
    ["AT&amp;T 3 × 4", "att-3-x-4"],
    ["100% sure, a%20b", "100-sure-a%20b"],
    ["日本", "%e6%97%a5%e6%9c%ac"],
    ["---", ""],
  ])("%j becomes %j", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it("cuts at 200 characters without splitting an encoded character", () => {
    expect(slugify("a".repeat(250))).toHaveLength(200);
    // Each 日 is nine characters encoded: 22 fit in 200.
    expect(slugify("日".repeat(30))).toBe("%e6%97%a5".repeat(22));
  });
});

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

  it("reads _embed as rest_parse_embed_param does: 0 embeds everything, false and other words are relations", async () => {
    type Embedded = { _embedded?: Record<string, unknown> }[];
    const keys = async (embed: string) => {
      const response = await cms.get<Embedded>(`/wp-json/wp/v2/resources?include=20&${embed}`);
      return Object.keys(response.body[0]._embedded ?? {});
    };
    expect(await keys("_embed")).toEqual(["wp:featuredmedia", "wp:term"]);
    expect(await keys("_embed=0")).toEqual(["wp:featuredmedia", "wp:term"]);
    expect(await keys("_embed=1")).toEqual(["wp:featuredmedia", "wp:term"]);
    expect(await keys("_embed=true")).toEqual(["wp:featuredmedia", "wp:term"]);
    expect(await keys("_embed=false")).toEqual([]);
    expect(await keys("_embed=wp:term")).toEqual(["wp:term"]);
    expect(await keys("_embed[]=wp:featuredmedia")).toEqual(["wp:featuredmedia"]);
  });

  it("takes PHP-style arrays as well as comma lists, and sanitizes slugs before matching", async () => {
    const included = await cms.get<{ id: number }[]>("/wp-json/wp/v2/resources?include[]=27&include[]=20&orderby=include");
    expect(included.body.map((r) => r.id)).toEqual([27, 20]);

    const slugs = await cms.get<{ slug: string }[]>(
      "/wp-json/wp/v2/resources?slug[]=cache-tags-explained&slug[]=Keyboard-First%20Filters&orderby=slug&order=asc",
    );
    expect(slugs.body.map((r) => r.slug)).toEqual(["cache-tags-explained", "keyboard-first-filters"]);

    const terms = await cms.get<{ id: number }[]>("/wp-json/wp/v2/resource_type?slug=ebook,%20webinar&orderby=id");
    expect(terms.body.map((t) => t.id)).toEqual([4, 5]);
  });

  it("answers orderby=include without include with core's 400", async () => {
    const response = await cms.get("/wp-json/wp/v2/resources?orderby=include");
    expect(response.status).toBe(400);
    expect(wpErrorSchema.parse(response.body)).toMatchObject({ code: "rest_orderby_include_missing_include", data: { status: 400 } });
  });

  it("puts core's per-parameter codes in data.details", async () => {
    const response = await cms.get("/wp-json/wp/v2/resources?per_page=0&page=0&include=1,x&order=up");
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "rest_invalid_param",
      message: "Invalid parameter(s): page, per_page, include[1], order",
      data: {
        status: 400,
        params: {
          page: "page must be greater than or equal to 1",
          per_page: "per_page must be between 1 (inclusive) and 100 (inclusive)",
          "include[1]": "include[1] is not of type integer.",
          order: "order is not one of asc and desc.",
        },
        details: {
          page: { code: "rest_out_of_bounds", data: null },
          per_page: { code: "rest_out_of_bounds", data: null },
          "include[1]": { code: "rest_invalid_type", data: { param: "include[1]" } },
          order: { code: "rest_not_in_enum", data: null },
        },
      },
    });
  });

  it("refuses an anonymous non-publish status as core's sanitizer does, after validation", async () => {
    const draft = await cms.get("/wp-json/wp/v2/resources?status=draft");
    expect(draft.status).toBe(400);
    expect(draft.body).toMatchObject({
      code: "rest_invalid_param",
      data: {
        status: 400,
        params: { status: "Status is forbidden." },
        details: { status: { code: "rest_forbidden_status", message: "Status is forbidden.", data: { status: 401 } } },
      },
    });

    // Validation runs first: an unknown status, or another bad parameter, is reported instead.
    const unknown = await cms.get("/wp-json/wp/v2/resources?status=draft,nonsense");
    expect(unknown.body).toMatchObject({ data: { details: { status: { code: "rest_not_in_enum" } } } });
    const both = await cms.get("/wp-json/wp/v2/resources?status=draft&per_page=0");
    expect(Object.keys((both.body as { data: { params: object } }).data.params)).toEqual(["per_page"]);

    const publish = await cms.get<unknown[]>("/wp-json/wp/v2/resources?status=publish");
    expect(publish.status).toBe(200);
  });

  it("sends no-cache and Allow on errors from the covered routes, as the plugin and core do", async () => {
    for (const path of [
      "/wp-json/wp/v2/resources?per_page=0",
      "/wp-json/wp/v2/resources?_embed&page=3",
      "/wp-json/wp/v2/resource_topic?per_page=0",
      "/wp-json/resource-hub/v1/resolve?slug=no-such-slug",
    ]) {
      const response = await cms.get(path);
      expect(response.status, path).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("cache-control"), path).toBe(NO_CACHE);
      expect(response.headers.get("allow"), path).toBe("GET");
    }
    // An item whose permission check fails has no allowed method, so no Allow header.
    for (const path of ["/wp-json/wp/v2/resources/9999", "/wp-json/wp/v2/resource_topic/9999"]) {
      const response = await cms.get(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("cache-control"), path).toBe(NO_CACHE);
      expect(response.headers.get("allow"), path).toBeNull();
    }
    // An unmatched route is outside the filter and has no matched route.
    const noRoute = await cms.get("/wp-json/wp/v2/posts");
    expect(noRoute.headers.get("cache-control")).toBeNull();
    expect(noRoute.headers.get("allow")).toBeNull();
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
    expect(response.headers.get("allow")).toBe("GET");
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
    expect(draft.headers.get("cache-control")).toBe(NO_CACHE);
    expect(draft.headers.get("allow")).toBeNull();
    expect(wpErrorSchema.parse(draft.body)).toMatchObject({
      code: "rest_forbidden",
      message: "Sorry, you are not allowed to do that.",
      data: { status: 401 },
    });
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
    expect(empty.headers.get("cache-control")).toBe(NO_CACHE);
    expect(wpErrorSchema.parse(empty.body).code).toBe("rest_invalid_param");
  });
});

describe("GET /resource-hub/v1/related/{id}", () => {
  it("puts published picks first, skips an unpublished one, then fills with the newest in the source's topics", async () => {
    // 33's picks are 34 (a draft), 29 (another topic) and 21 (also in topic); 20 is the newest sharing a topic.
    const response = await cms.related(33);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(NO_CACHE);
    expect(response.headers.get("allow")).toBe("GET");
    expectContract("related-response", response.body);
    expect(response.body).toEqual({
      items: [
        { id: 29, source: "pick" },
        { id: 21, source: "pick" },
        { id: 20, source: "topic" },
      ],
    });

    // A larger count fills further, newest first, with no duplicate and never the source.
    const ten = await cms.related(33, 10);
    expectContract("related-response", ten.body);
    const items = (ten.body as { items: { id: number; source: string }[] }).items;
    expect(items.map((item) => item.id)).toEqual([29, 21, 20, 22, 25, 27, 28, 31]);
    expect(items.filter((item) => item.source === "pick").map((item) => item.id)).toEqual([29, 21]);

    expect((await cms.related(24)).body).toEqual({
      items: [
        { id: 26, source: "pick" },
        { id: 22, source: "topic" },
        { id: 28, source: "topic" },
      ],
    });
  });

  it("caps picks at count, and gives a source with no topics its picks alone", async () => {
    expect((await cms.related(33, 1)).body).toEqual({ items: [{ id: 29, source: "pick" }] });

    await cms.setTopics(33, []);
    const alone = await cms.related(33, 10);
    expectContract("related-response", alone.body);
    expect(alone.body).toEqual({ items: [{ id: 29, source: "pick" }, { id: 21, source: "pick" }] });

    await cms.setPicks(33, []);
    expect((await cms.related(33)).body).toEqual({ items: [] });
  });

  it("follows the picks the control endpoint sets, sanitized as the plugin sanitizes them", async () => {
    const summary = await cms.setPicks(20, [27, 27, 20, 32]);
    expect(summary.picks).toEqual([27, 32]);
    expect((await cms.related(20, 2)).body).toEqual({
      items: [
        { id: 27, source: "pick" },
        { id: 32, source: "pick" },
      ],
    });
    await expect(cms.setPicks(20, [9999])).rejects.toMatchObject({ status: 422 });
    await expect(cms.setPicks(20, [0])).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a count outside 1 to 10 and an ID that is not a published resource", async () => {
    for (const count of ["0", "11", "abc", "2.5"]) {
      const response = await cms.related(33, count);
      expect(response.status, count).toBe(400);
      expect(response.headers.get("cache-control"), count).toBe(NO_CACHE);
      expect(wpErrorSchema.parse(response.body)).toMatchObject({ code: "rest_invalid_param", data: { status: 400 } });
    }
    expect((await cms.related(33, "11")).body).toMatchObject({
      data: { params: { count: "count must be between 1 (inclusive) and 10 (inclusive)" }, details: { count: { code: "rest_out_of_bounds" } } },
    });

    for (const id of [34, 9999]) {
      const response = await cms.related(id);
      expect(response.status, String(id)).toBe(404);
      expect(response.headers.get("cache-control")).toBe(NO_CACHE);
      expect(wpErrorSchema.parse(response.body)).toMatchObject({ data: { status: 404 } });
    }
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
  it("names the mock that answered in /__mock/health", async () => {
    expect(await cms.health()).toEqual({
      ok: true,
      dir: resolve(__dirname, "../e2e/mock-cms"),
      pid: process.pid,
      origin: server.origin,
    });
  });

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
