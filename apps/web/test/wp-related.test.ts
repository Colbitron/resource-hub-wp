import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toCard, UNTITLED } from "../lib/wp/cards";
import { CmsError } from "../lib/wp/fetch";
import {
  getNewestInTopic,
  getRelated,
  inRelatedOrder,
  RELATED_BLOCK_SPARE,
  RELATED_BLOCK_TOPIC_PARAM,
  RELATED_COUNT,
  toRelatedCard,
} from "../lib/wp/related";
import { MAX_RELATED_ITEMS } from "../lib/wp/schemas/related";
import { wpResourceSchema, type WpResource } from "../lib/wp/schemas/rest";

/**
 * The related route's reader (issue #50) with `fetch` stubbed: the URL,
 * the `count` it sends, the tags and cache options, what the two 404s the
 * section treats as "no answer" come back as, what every other answer
 * does, the guard against the host and repeated IDs, and `inRelatedOrder`,
 * which fixes the rows' order from the route's answer.
 */

const API = "https://cms.example/wp-json";

interface Call {
  readonly url: URL;
  readonly init: RequestInit & { next?: { revalidate?: number; tags?: string[] } };
}

let calls: Call[];
let handler: (url: URL) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=UTF-8" } });
}

function wpError(status: number, code: string): Response {
  return json({ code, message: "Mentions https://cms.example/wp-json/", data: { status } }, status);
}

const THREE = {
  items: [
    { id: 118, source: "pick" },
    { id: 104, source: "topic" },
    { id: 99, source: "topic" },
  ],
};

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

describe("getRelated", () => {
  it("asks the plugin's related route for the ID with the route's default count, tagged for the host, and returns the items in order", async () => {
    handler = () => json(THREE);
    expect(await getRelated(33, { hostSlug: "Host-Page" })).toEqual(THREE.items);
    expect(calls).toHaveLength(1);
    expect(RELATED_COUNT).toBe(3);
    expect(calls[0].url.href).toBe(`${API}/resource-hub/v1/related/33?count=3`);
    expect(calls[0].init.next).toEqual({ revalidate: 3600, tags: ["resources", "terms", "resource:host-page"] });
    expect(calls[0].init.cache).toBe("force-cache");
    expect(calls[0].init.redirect).toBe("error");
  });

  it("sends the count asked for", async () => {
    handler = () => json({ items: [] });
    expect(await getRelated(33, { hostSlug: "host", count: MAX_RELATED_ITEMS })).toEqual([]);
    expect(calls[0].url.search).toBe("?count=10");
  });

  it("is null for core's rest_no_route, which a CMS without the plugin's route answers, asks nothing else, and warns once per process", async () => {
    // A fresh module, so the once-per-process flag starts unset whatever ran before.
    vi.resetModules();
    const { getRelated: freshGetRelated } = await import("../lib/wp/related");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handler = () => wpError(404, "rest_no_route");
    expect(await freshGetRelated(33, { hostSlug: "host" })).toBeNull();
    expect(calls).toHaveLength(1);
    expect(await freshGetRelated(34, { hostSlug: "other" })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/^getRelated: \/resource-hub\/v1\/related\/33 answered rest_no_route/);
    expect(String(warn.mock.calls[0][0])).not.toContain("cms.example");
  });

  it("is null for the plugin's resource_hub_not_found, a host no longer published, and warns each time without naming the CMS", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handler = () => wpError(404, "resource_hub_not_found");
    expect(await getRelated(33, { hostSlug: "host" })).toBeNull();
    expect(await getRelated(33, { hostSlug: "host" })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toBe(
      "getRelated: /resource-hub/v1/related/33 answered resource_hub_not_found for a resource read as published; rendering without the related list",
    );
  });

  it("throws a CmsError on any other answer: a 500, a 400, a 404 with another code, a body that is not JSON", async () => {
    handler = () => new Response("<html>down</html>", { status: 500 });
    expect((await cmsError(() => getRelated(33, { hostSlug: "host" }))).reason).toBe("status");

    handler = () => wpError(400, "rest_invalid_param");
    const invalid = await cmsError(() => getRelated(33, { hostSlug: "host" }));
    expect(invalid.reason).toBe("status");
    expect(invalid.message).toBe("CMS request to /resource-hub/v1/related/33 failed: HTTP 400 (rest_invalid_param)");

    handler = () => wpError(404, "rest_post_invalid_id");
    expect((await cmsError(() => getRelated(33, { hostSlug: "host" }))).status).toBe(404);

    handler = () => new Response("not json", { status: 200 });
    expect((await cmsError(() => getRelated(33, { hostSlug: "host" }))).reason).toBe("json");
  });

  it("throws a CmsError, naming no CMS host, when the body fails the reader schema", async () => {
    handler = () => json({ items: [{ id: 1, source: "random" }] });
    const error = await cmsError(() => getRelated(33, { hostSlug: "host" }));
    expect(error.reason).toBe("schema");
    expect(error.message).toContain("items.0.source");
    expect(error.message).not.toContain("cms.example");

    handler = () => json({ items: Array.from({ length: 11 }, (_, i) => ({ id: i + 1, source: "topic" })) });
    expect((await cmsError(() => getRelated(33, { hostSlug: "host" }))).reason).toBe("schema");
  });

  it("drops a key it does not know, at either level", async () => {
    handler = () => json({ items: [{ id: 118, source: "pick", title: "x" }], total: 1 });
    expect(await getRelated(33, { hostSlug: "host" })).toEqual([{ id: 118, source: "pick" }]);
  });

  it("drops the host itself and a repeated ID, which the contract says never come, as a guard", async () => {
    handler = () =>
      json({
        items: [
          { id: 33, source: "pick" },
          { id: 5, source: "pick" },
          { id: 5, source: "topic" },
          { id: 7, source: "topic" },
        ],
      });
    expect(await getRelated(33, { hostSlug: "host" })).toEqual([
      { id: 5, source: "pick" },
      { id: 7, source: "topic" },
    ]);
  });

  it("throws a RangeError on a bad ID, a bad count or a bad host slug, without a request", async () => {
    await expect(getRelated(0, { hostSlug: "host" })).rejects.toThrow(RangeError);
    await expect(getRelated(1.5, { hostSlug: "host" })).rejects.toThrow(RangeError);
    await expect(getRelated(33, { hostSlug: "host", count: 0 })).rejects.toThrow(RangeError);
    await expect(getRelated(33, { hostSlug: "host", count: 11 })).rejects.toThrow(RangeError);
    await expect(getRelated(33, { hostSlug: "" })).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });
});

describe("getNewestInTopic", () => {
  const RESOURCES = JSON.parse(
    readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/wp/resources.list.json"), "utf8"),
  ) as unknown[];

  function paged(body: unknown[]): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-WP-Total": String(body.length), "X-WP-TotalPages": "1" },
    });
  }

  it("asks the collection for the topic's newest, with _embed, tagged with the topic's slug and terms", async () => {
    handler = () => paged(RESOURCES);
    const items = await getNewestInTopic({ topicId: 11, topicSlug: "Performance", count: 9 });
    expect(items.map((item) => item.id)).toEqual((RESOURCES as { id: number }[]).map((item) => item.id));
    expect(calls).toHaveLength(1);
    expect(calls[0].url.href).toBe(`${API}/wp/v2/resources?_embed&per_page=9&orderby=date&order=desc&resource_topic=11&rh_topic=performance`);
    expect(calls[0].init.next).toEqual({ revalidate: 3600, tags: ["topic:performance", "terms"] });
    expect(calls[0].init.cache).toBe("force-cache");
  });

  it("puts the canonical slug in the URL, so two markers for one topic ID with different slugs never share a cache entry under the wrong topic tag", async () => {
    handler = () => paged(RESOURCES);
    await getNewestInTopic({ topicId: 11, topicSlug: "performance", count: 9 });
    await getNewestInTopic({ topicId: 11, topicSlug: "Stale-Slug", count: 9 });
    expect(calls).toHaveLength(2);
    // The cache key (the URL) differs exactly where the tags do.
    expect(calls[0].url.searchParams.get(RELATED_BLOCK_TOPIC_PARAM)).toBe("performance");
    expect(calls[1].url.searchParams.get(RELATED_BLOCK_TOPIC_PARAM)).toBe("stale-slug");
    expect(calls[0].url.href).not.toBe(calls[1].url.href);
    expect(calls[0].init.next?.tags).toContain("topic:performance");
    expect(calls[1].init.next?.tags).toContain("topic:stale-slug");
    // The same ID filters both: the extra argument is the cache key's alone.
    expect(calls.map((call) => call.url.searchParams.get("resource_topic"))).toEqual(["11", "11"]);
  });

  it("asks for a bounded few more than the block shows", () => {
    expect(RELATED_BLOCK_SPARE).toBe(6);
    expect(MAX_RELATED_ITEMS + RELATED_BLOCK_SPARE).toBeLessThanOrEqual(100);
  });

  it("throws a RangeError on a bad topic ID, count or slug, without a request", async () => {
    await expect(getNewestInTopic({ topicId: 0, topicSlug: "performance", count: 3 })).rejects.toThrow(RangeError);
    await expect(getNewestInTopic({ topicId: 11, topicSlug: "performance", count: 0 })).rejects.toThrow(RangeError);
    await expect(getNewestInTopic({ topicId: 11, topicSlug: "performance", count: 101 })).rejects.toThrow(RangeError);
    await expect(getNewestInTopic({ topicId: 11, topicSlug: "a b", count: 3 })).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });

  it("throws a CmsError, naming no CMS host, when the collection fails", async () => {
    handler = () => wpError(500, "internal_server_error");
    const error = await cmsError(() => getNewestInTopic({ topicId: 11, topicSlug: "performance", count: 3 }));
    expect(error.reason).toBe("status");
    expect(error.message).not.toContain("cms.example");
  });
});

describe("toRelatedCard", () => {
  const single = JSON.parse(
    readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/wp/resource.single.json"), "utf8"),
  ) as Record<string, unknown>;

  function withTitle(rendered: string): WpResource {
    return wpResourceSchema.parse({ ...single, title: { rendered } });
  }

  it("is the row the listing would show for a titled, typed resource", () => {
    const resource = wpResourceSchema.parse(single);
    expect(toRelatedCard(resource)).toEqual(toCard(resource));
    expect(toRelatedCard(resource)?.title).toBe("A field guide to revalidation");
  });

  it("is null for a resource with no visible title, where the listing's row would say Untitled resource", () => {
    for (const rendered of ["", "   ", "​﻿", "<em> </em>", "&nbsp;‍"]) {
      const resource = withTitle(rendered);
      expect(toCard(resource)?.title, JSON.stringify(rendered)).toBe(UNTITLED);
      expect(toRelatedCard(resource), JSON.stringify(rendered)).toBeNull();
    }
    // A real title that happens to read "Untitled resource" is a title.
    expect(toRelatedCard(withTitle(UNTITLED))?.title).toBe(UNTITLED);
  });

  it("is null for a resource with no type, as toCard is", () => {
    const resource = wpResourceSchema.parse({ ...single, resource_type: [] });
    expect(toCard(resource)).toBeNull();
    expect(toRelatedCard(resource)).toBeNull();
  });
});

describe("inRelatedOrder", () => {
  const resource = (id: number) => ({ id }) as WpResource;

  it("orders the resources as the IDs are, each once, dropping any the IDs do not name", () => {
    const ordered = inRelatedOrder([7, 5, 5, 9], [resource(5), resource(12), resource(7)]);
    expect(ordered.map((item) => item.id)).toEqual([7, 5]);
  });

  it("is empty for no IDs or no resources", () => {
    expect(inRelatedOrder([], [resource(1)])).toEqual([]);
    expect(inRelatedOrder([1], [])).toEqual([]);
  });
});
