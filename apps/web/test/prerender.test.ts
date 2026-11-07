import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PRERENDER_TIMEOUT_MS,
  PROBE_CONCURRENCY,
  RECENT_PER_TYPE,
  RECENT_RESOURCES,
  libraryParams,
  mapConcurrently,
  prerenderParams,
  resourcePageParams,
  rootPageParams,
  selectResourceParams,
  typeListingParams,
} from "../lib/prerender";
import { CmsError } from "../lib/wp/fetch";
import { wpResourceSchema, wpTermSchema, type WpResource, type WpTerm } from "../lib/wp/schemas/rest";

/**
 * What the build prerenders (ADR 0053; `lib/prerender.ts`): the selection
 * of resource params as a union of the newest and the newest per type, each
 * slug once, in order; the probes that call the data layer and keep only
 * what answered; and the rule that every probe is `[]` with one warning on
 * an error or a timeout, so `next build` cannot fail for a CMS reason. The
 * data layer is injected, so no fetch happens here.
 */

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/wp");
const RESOURCES = wpResourceSchema.array().parse(JSON.parse(readFileSync(path.join(fixtures, "resources.list.json"), "utf8")));
const TYPES = wpTermSchema.array().parse(JSON.parse(readFileSync(path.join(fixtures, "resource_type.list.json"), "utf8")));

/** A captured resource, re-slugged and re-typed, so a test can build lists with known slugs and types. */
function resource(slug: string, typeSlug: string, id = 1000 + slug.length): WpResource {
  const base = RESOURCES[0];
  const type = TYPES.find((term) => term.slug === typeSlug);
  if (type === undefined) throw new Error(`no captured type ${typeSlug}`);
  const terms = base._embedded["wp:term"].map((list) =>
    list.map((term) => (term.taxonomy === "resource_type" ? { ...term, id: type.id, slug: type.slug, name: type.name } : term)),
  );
  return { ...base, id, slug, resource_type: [type.id], _embedded: { ...base._embedded, "wp:term": terms } };
}

function slugs(params: readonly { slug: string }[]): string[] {
  return params.map((param) => param.slug);
}

const silent = () => {};

afterEach(() => {
  vi.useRealTimers();
});

describe("the constants", () => {
  it("are 50 newest across types, 10 newest per type, a 10 s budget per route and 8 reads in flight", () => {
    expect(RECENT_RESOURCES).toBe(50);
    expect(RECENT_PER_TYPE).toBe(10);
    expect(PRERENDER_TIMEOUT_MS).toBe(10_000);
    expect(PROBE_CONCURRENCY).toBe(8);
  });
});

describe("selectResourceParams", () => {
  it("is the newest first, then each type's list in order, with no slug twice", () => {
    const recent = [resource("newest", "webinar"), resource("second", "article"), resource("third", "ebook")];
    const byType = new Map([
      ["article", [resource("second", "article"), resource("older-article", "article")]],
      ["webinar", [resource("newest", "webinar"), resource("older-webinar", "webinar")]],
    ]);
    expect(selectResourceParams(recent, byType)).toEqual([
      { type: "webinar", slug: "newest" },
      { type: "article", slug: "second" },
      { type: "ebook", slug: "third" },
      { type: "article", slug: "older-article" },
      { type: "webinar", slug: "older-webinar" },
    ]);
  });

  it("takes the type from the resource's own embedded term, not the list it came from", () => {
    const byType = new Map([["webinar", [resource("moved", "podcast")]]]);
    expect(selectResourceParams([], byType)).toEqual([{ type: "podcast", slug: "moved" }]);
  });

  it("leaves out a resource with no type, two types, or a type the routes cannot serve", () => {
    const none = { ...resource("no-type", "webinar"), resource_type: [] };
    const two = { ...resource("two-types", "webinar"), resource_type: [3, 5] };
    const reserved = resource("reserved-type", "webinar");
    reserved._embedded["wp:term"] = reserved._embedded["wp:term"].map((list) =>
      list.map((term) => (term.taxonomy === "resource_type" ? { ...term, slug: "topic" } : term)),
    );
    expect(selectResourceParams([none, two, reserved, resource("fine", "ebook")], new Map())).toEqual([{ type: "ebook", slug: "fine" }]);
  });

  it("writes every slug in its canonical form, and dedupes across forms", () => {
    const upper = resource("%E6%97%A5-Guide", "webinar");
    const lower = resource("%e6%97%a5-guide", "webinar");
    expect(selectResourceParams([upper], new Map([["webinar", [lower]]]))).toEqual([{ type: "webinar", slug: "%e6%97%a5-guide" }]);
  });

  it("is empty for empty lists", () => {
    expect(selectResourceParams([], new Map())).toEqual([]);
  });
});

describe("mapConcurrently", () => {
  it("keeps at most the limit in flight and returns results in the items' order", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapConcurrently([30, 10, 20, 5, 15], 2, async (ms) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, ms));
      inFlight -= 1;
      return ms * 2;
    });
    expect(results).toEqual([60, 20, 40, 10, 30]);
    expect(peak).toBe(2);
  });

  it("is empty for no items, and rejects when a call does", async () => {
    expect(await mapConcurrently([], 4, async (x: number) => x)).toEqual([]);
    await expect(mapConcurrently([1, 2], 4, async (x) => {
      if (x === 2) throw new Error("boom");
      return x;
    })).rejects.toThrow("boom");
  });
});

describe("prerenderParams", () => {
  it("returns what the probe gives", async () => {
    const warn = vi.fn();
    expect(await prerenderParams("/x", async () => [{ a: 1 }], { warn })).toEqual([{ a: 1 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("is [] with one warning naming the route when the probe throws, and the warning never names the CMS", async () => {
    vi.stubEnv("WP_API_URL", "https://cms.example/wp-json");
    const warn = vi.fn();
    const probe = async () => {
      throw new CmsError("/wp/v2/resources", "network", "network error ECONNREFUSED");
    };
    expect(await prerenderParams("/resources/[type]/[slug]", probe, { warn })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain("prerender /resources/[type]/[slug]");
    expect(message).toContain("renders on its first request");
    expect(message).toContain("network error ECONNREFUSED");
    expect(message).not.toMatch(/cms\.example/i);
    vi.unstubAllEnvs();
  });

  it("scrubs the CMS host from a message that names it", async () => {
    vi.stubEnv("WP_API_URL", "https://cms.example/wp-json");
    const warn = vi.fn();
    await prerenderParams("/x", async () => {
      throw new Error("connect to https://cms.example/wp-json failed");
    }, { warn });
    expect((warn.mock.calls[0] as [string])[0]).toContain("https://[cms]/wp-json");
    vi.unstubAllEnvs();
  });

  it("is [] with one warning when the probe outlives the budget", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const pending = prerenderParams("/[[...path]]", () => new Promise<never>(() => {}), { warn, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [string])[0]).toContain("no answer from the CMS within 1000 ms");
  });

  it("uses PRERENDER_TIMEOUT_MS by default", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const pending = prerenderParams("/x", () => new Promise<never>(() => {}), { warn });
    await vi.advanceTimersByTimeAsync(PRERENDER_TIMEOUT_MS - 1);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual([]);
  });
});

/** The captured type terms, each with a count, so the filter bar would offer them. */
function types(counts: Record<string, number>): WpTerm[] {
  return TYPES.map((term) => ({ ...term, count: counts[term.slug] ?? 0 }));
}

describe("resourcePageParams", () => {
  it("asks for the 50 newest and the 10 newest of each offered type, unions them, and keeps the slugs whose decision is a render", async () => {
    const listRecentResources = vi.fn(async ({ type }: { type?: string; count: number }) => {
      if (type === undefined) return [resource("a", "webinar"), resource("b", "article")];
      if (type === "webinar") return [resource("a", "webinar"), resource("c", "webinar")];
      if (type === "article") return [resource("d", "article")];
      return [];
    });
    const decideResourceRequest = vi.fn(async (_type: string, slug: string) =>
      slug === "c" ? ({ kind: "not-found" } as const) : ({ kind: "render", type: _type, slug } as never),
    );
    const params = await resourcePageParams({
      listRecentResources,
      listTerms: async () => types({ webinar: 2, article: 1, podcast: 0 }),
      decideResourceRequest,
      warn: silent,
    });
    expect(slugs(params)).toEqual(["a", "b", "d"]);
    expect(listRecentResources.mock.calls.map(([options]) => options)).toEqual([
      { count: RECENT_RESOURCES },
      { type: "article", count: RECENT_PER_TYPE },
      { type: "webinar", count: RECENT_PER_TYPE },
    ]);
    // Every candidate was decided once, so its slug lookup is in the Data Cache for the render.
    expect(decideResourceRequest.mock.calls.map(([, slug]) => slug).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("is [] with one warning when any read fails", async () => {
    const warn = vi.fn();
    const params = await resourcePageParams({
      listRecentResources: async ({ type }) => {
        if (type === "webinar") throw new CmsError("/wp/v2/resources", "status", "HTTP 502", 502);
        return [resource("a", "webinar")];
      },
      listTerms: async () => types({ webinar: 2 }),
      decideResourceRequest: async (type, slug) => ({ kind: "render", type, slug }) as never,
      warn,
    });
    expect(params).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [string])[0]).toContain("HTTP 502");
  });

  it("is [] with one warning when the CMS is slow past the budget", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const pending = resourcePageParams({
      listRecentResources: () => new Promise<never>(() => {}),
      listTerms: () => new Promise<never>(() => {}),
      timeoutMs: 50,
      warn,
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("typeListingParams", () => {
  it("is each offered type whose first page loads, in canonical form", async () => {
    const loadListing = vi.fn(async ({ filter }: { filter: { type?: string } }) => (filter.type === "podcast" ? null : ({} as never)));
    const params = await typeListingParams({
      listTerms: async () => types({ webinar: 2, podcast: 1, article: 3, ebook: 0 }),
      loadListing,
      warn: silent,
    });
    expect(params).toEqual([{ type: "article" }, { type: "webinar" }]);
    expect(loadListing.mock.calls.map(([valid]) => valid)).toEqual([
      { filter: { type: "article" }, page: 1 },
      { filter: { type: "podcast" }, page: 1 },
      { filter: { type: "webinar" }, page: 1 },
    ]);
  });

  it("is [] with one warning when the terms cannot be read", async () => {
    const warn = vi.fn();
    expect(
      await typeListingParams({
        listTerms: async () => {
          throw new CmsError("/wp/v2/resource_type", "timeout", "no complete answer within 10000 ms");
        },
        warn,
      }),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("libraryParams", () => {
  it("is the one root param when the library loads, and [] when it is a 404 or fails", async () => {
    expect(await libraryParams({ loadListing: async () => ({}) as never, warn: silent })).toEqual([{ rest: [] }]);
    expect(await libraryParams({ loadListing: async () => null, warn: silent })).toEqual([]);
    const warn = vi.fn();
    expect(
      await libraryParams({
        loadListing: async () => {
          throw new CmsError("/wp/v2/resources", "network", "network error ENOTFOUND");
        },
        warn,
      }),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("rootPageParams", () => {
  it("is the one root param for a page or the welcome page, and [] for a redirect, a 404 or a failure", async () => {
    expect(await rootPageParams({ decidePageRequest: async () => ({ kind: "welcome" }), warn: silent })).toEqual([{ path: [] }]);
    expect(await rootPageParams({ decidePageRequest: async () => ({ kind: "render", page: {} as never, path: "/" }), warn: silent })).toEqual([{ path: [] }]);
    expect(await rootPageParams({ decidePageRequest: async () => ({ kind: "redirect", path: "/x/" }), warn: silent })).toEqual([]);
    expect(await rootPageParams({ decidePageRequest: async () => ({ kind: "not-found" }), warn: silent })).toEqual([]);
    const warn = vi.fn();
    expect(
      await rootPageParams({
        decidePageRequest: async () => {
          throw new CmsError("/resource-hub/v1/page", "status", "HTTP 500", 500);
        },
        warn,
      }),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
