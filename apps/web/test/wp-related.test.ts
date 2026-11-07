import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toCard, UNTITLED } from "../lib/wp/cards";
import { CmsError } from "../lib/wp/fetch";
import { getRelated, inRelatedOrder, RELATED_COUNT, toRelatedCard } from "../lib/wp/related";
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

  it("is null for core's rest_no_route, which a CMS without the plugin's route answers, and asks nothing else", async () => {
    handler = () => wpError(404, "rest_no_route");
    expect(await getRelated(33, { hostSlug: "host" })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("is null for the plugin's resource_hub_not_found, a host no longer published", async () => {
    handler = () => wpError(404, "resource_hub_not_found");
    expect(await getRelated(33, { hostSlug: "host" })).toBeNull();
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
