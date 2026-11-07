import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_FAILED_SHARE,
  PRERENDER_TIMEOUT_MS,
  PROBE_CONCURRENCY,
  RECENT_PER_TYPE,
  RECENT_RESOURCES,
  RESOURCE_PRERENDER_TIMEOUT_MS,
  libraryParams,
  mapConcurrently,
  paramValue,
  prerenderParams,
  resourcePageParams,
  rootPageParams,
  selectResourceParams,
  typeListingParams,
  type Stop,
} from "../lib/prerender";
import { decideResourceRequest } from "../lib/redirects";
import { CmsError } from "../lib/wp/fetch";
import { wpResourceSchema, wpTermSchema, type WpResource, type WpTerm } from "../lib/wp/schemas/rest";

/**
 * What the build prerenders (ADR 0043; `lib/prerender.ts`): the selection
 * of resource params as a union of the newest and the newest per type, each
 * slug once, in order and in the decoded form Next.js encodes back; the
 * probes that call the data layer and keep only what answered; the partial
 * result a probe keeps when its budget runs out; the stop flag that keeps a
 * finished probe from reading on; and the rule that every probe is `[]`
 * with one warning on an error, so `next build` cannot fail for a CMS
 * reason. The data layer is injected, so no fetch happens here.
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

/** `resource`, with the embedded type term's slug replaced by `typeSlug` as written, whether or not a captured type has it. */
function resourceWithTypeSlug(slug: string, typeSlug: string): WpResource {
  const made = resource(slug, "webinar");
  made._embedded["wp:term"] = made._embedded["wp:term"].map((list) =>
    list.map((term) => (term.taxonomy === "resource_type" ? { ...term, slug: typeSlug } : term)),
  );
  return made;
}

function slugs(params: readonly { slug: string }[]): string[] {
  return params.map((param) => param.slug);
}

/** A render decision for any slug, typed as the route's decision. */
function render(type: string, slug: string) {
  return { kind: "render", type, slug } as never;
}

const silent = () => {};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the constants", () => {
  it("are 50 newest across types, 10 newest per type, 10 s per route and 30 s for the resource route, 8 reads in flight, half the candidates may fail", () => {
    expect(RECENT_RESOURCES).toBe(50);
    expect(RECENT_PER_TYPE).toBe(10);
    expect(PRERENDER_TIMEOUT_MS).toBe(10_000);
    expect(RESOURCE_PRERENDER_TIMEOUT_MS).toBe(30_000);
    expect(PROBE_CONCURRENCY).toBe(8);
    expect(MAX_FAILED_SHARE).toBe(0.5);
  });
});

describe("paramValue", () => {
  it("is the canonical slug decoded, so Next.js encodes it back once", () => {
    expect(paramValue("example")).toBe("example");
    expect(paramValue("Example")).toBe("example");
    expect(paramValue("%e6%97%a5-guide")).toBe("日-guide");
    expect(paramValue("%E6%97%A5-Guide")).toBe("日-guide");
    expect(paramValue("日-guide")).toBe("日-guide");
    expect(paramValue("100%25")).toBe("100%");
  });

  it("is null for an escape that is not UTF-8, which WordPress never writes", () => {
    expect(paramValue("a%ffb")).toBeNull();
  });

  it("is null when the decoded form is not a slug the routes accept: a slash or a space", () => {
    for (const stored of ["a%2fb", "a%2Fb", "a%20b"]) {
      expect(paramValue(stored), stored).toBeNull();
      expect(paramValue(stored, "type"), stored).toBeNull();
    }
    // A type decoded to a reserved word is not a type param; it is still a slug.
    expect(paramValue("topic", "type")).toBeNull();
    expect(paramValue("topic")).toBe("topic");
  });

  it("throws on a slug that is not one, as the builders do", () => {
    expect(() => paramValue("")).toThrow(RangeError);
    expect(() => paramValue("a/b")).toThrow(RangeError);
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
    const reserved = resourceWithTypeSlug("reserved-type", "topic");
    const reservedPage = resourceWithTypeSlug("reserved-page", "Page");
    expect(selectResourceParams([none, two, reserved, reservedPage, resource("fine", "ebook")], new Map())).toEqual([
      { type: "ebook", slug: "fine" },
    ]);
  });

  it("writes slugs decoded, as Next.js takes a param, and dedupes across every stored form", () => {
    const upper = resource("%E6%97%A5-Guide", "webinar");
    const lower = resource("%e6%97%a5-guide", "webinar");
    const raw = resource("日-guide", "webinar");
    expect(selectResourceParams([upper], new Map([["webinar", [lower, raw]]]))).toEqual([{ type: "webinar", slug: "日-guide" }]);
  });

  it("decodes a non-ASCII type slug the same way, and skips a slug that cannot be decoded", () => {
    const japaneseType = resourceWithTypeSlug("in-a-japanese-type", "%e6%97%a5");
    const undecodable = resource("bad%ffslug", "ebook");
    expect(selectResourceParams([japaneseType, undecodable], new Map())).toEqual([{ type: "日", slug: "in-a-japanese-type" }]);
  });

  it("skips a slug or a type that decodes to a slash or a space, which no route could serve", () => {
    const slashSlug = resource("a%2fb", "ebook");
    const spaceSlug = resource("a%20b", "ebook");
    const slashType = resourceWithTypeSlug("in-a-slash-type", "a%2fb");
    const spaceType = resourceWithTypeSlug("in-a-space-type", "a%20b");
    expect(selectResourceParams([slashSlug, spaceSlug, slashType, spaceType, resource("fine", "ebook")], new Map())).toEqual([
      { type: "ebook", slug: "fine" },
    ]);
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
    await expect(
      mapConcurrently([1, 2], 4, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow("boom");
  });

  it("starts no further call once stopped, and leaves those items undefined", async () => {
    const stop: Stop = { stopped: false };
    const started: number[] = [];
    const results = await mapConcurrently(
      [1, 2, 3, 4, 5, 6],
      2,
      async (item) => {
        started.push(item);
        await new Promise((resolve) => setTimeout(resolve, item));
        // The first to finish stops the rest: the other one in flight finishes, nothing after them starts.
        if (item === 1) stop.stopped = true;
        return item;
      },
      stop,
    );
    // The two in flight finish; nothing after them starts.
    expect(started).toEqual([1, 2]);
    expect(results).toEqual([1, 2, undefined, undefined, undefined, undefined]);
  });
});

describe("prerenderParams", () => {
  it("returns what the probe gives", async () => {
    const warn = vi.fn();
    expect(await prerenderParams("/x", async () => [{ a: 1 }], 1000, { warn })).toEqual([{ a: 1 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("is [] with one warning naming the route when the probe throws, and the warning never names the CMS", async () => {
    vi.stubEnv("WP_API_URL", "https://cms.example/wp-json");
    const warn = vi.fn();
    const probe = async () => {
      throw new CmsError("/wp/v2/resources", "network", "network error ECONNREFUSED");
    };
    expect(await prerenderParams("/resources/[type]/[slug]", probe, 1000, { warn })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain("prerender /resources/[type]/[slug]");
    expect(message).toContain("renders on its first request");
    expect(message).toContain("network error ECONNREFUSED");
    expect(message).not.toMatch(/cms\.example/i);
  });

  it("scrubs the CMS host from a message that names it", async () => {
    vi.stubEnv("WP_API_URL", "https://cms.example/wp-json");
    const warn = vi.fn();
    await prerenderParams(
      "/x",
      async () => {
        throw new Error("connect to https://cms.example/wp-json failed");
      },
      1000,
      { warn },
    );
    expect((warn.mock.calls[0] as [string])[0]).toContain("https://[cms]/wp-json");
  });

  it("is [] with one warning when the probe outlives the budget with nothing decided", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const pending = prerenderParams("/[[...path]]", () => new Promise<never>(() => {}), 1000, { warn });
    await vi.advanceTimersByTimeAsync(999);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [string])[0]).toContain("no answer from the CMS within 1000 ms");
  });

  it("keeps the params decided before the budget ran out, with one warning that counts them", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const pending = prerenderParams<{ slug: string }>(
      "/resources/[type]/[slug]",
      async ({ partial }) => {
        partial.push({ slug: "a" });
        partial.push({ slug: "b" });
        await new Promise<never>(() => {});
        return [];
      },
      1000,
      { warn },
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual([{ slug: "a" }, { slug: "b" }]);
    expect((warn.mock.calls[0] as [string])[0]).toBe(
      "prerender /resources/[type]/[slug]: the CMS did not answer everything within 1000 ms; prerendering the 2 paths that answered, and the rest render on their first request",
    );
  });

  it("sets the stop flag when it returns, throws or times out", async () => {
    vi.useFakeTimers();
    const seen: Stop[] = [];
    await prerenderParams("/x", async ({ stop }) => (seen.push(stop), []), 1000, { warn: silent });
    await prerenderParams(
      "/x",
      async ({ stop }) => {
        seen.push(stop);
        throw new Error("boom");
      },
      1000,
      { warn: silent },
    );
    const pending = prerenderParams("/x", async ({ stop }) => (seen.push(stop), new Promise<never>(() => {})), 1000, { warn: silent });
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(seen.map((stop) => stop.stopped)).toEqual([true, true, true]);
  });

  it("takes the route's budget unless the options give one", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const pending = prerenderParams("/x", () => new Promise<never>(() => {}), PRERENDER_TIMEOUT_MS, { warn });
    await vi.advanceTimersByTimeAsync(PRERENDER_TIMEOUT_MS - 1);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual([]);
    const overridden = prerenderParams("/x", () => new Promise<never>(() => {}), PRERENDER_TIMEOUT_MS, { warn, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await overridden).toEqual([]);
  });
});

/** The captured type terms, each with a count, so the filter bar would offer them. */
function types(counts: Record<string, number>): WpTerm[] {
  return TYPES.map((term) => ({ ...term, count: counts[term.slug] ?? 0 }));
}

describe("the resource route's own gate", () => {
  it("answers a decoded slash or space in either segment with not-found before any read, so a param that slipped through could only be skipped", async () => {
    const bySlug = vi.fn(async () => null);
    const resolve = vi.fn(async () => null);
    for (const [type, slug] of [
      ["article", "a/b"],
      ["article", "a b"],
      ["a/b", "fine"],
      ["a b", "fine"],
    ]) {
      expect(await decideResourceRequest(type, slug, { getResourceBySlug: bySlug, resolveSlug: resolve }), `${type}/${slug}`).toEqual({ kind: "not-found" });
    }
    expect(bySlug).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("resourcePageParams", () => {
  it("asks for the 50 newest and the 10 newest of each offered type, unions them, and keeps the slugs whose decision is a render", async () => {
    const listRecentResources = vi.fn(async ({ type }: { type?: string; count: number }) => {
      if (type === undefined) return [resource("a", "webinar"), resource("b", "article")];
      if (type === "webinar") return [resource("a", "webinar"), resource("c", "webinar")];
      if (type === "article") return [resource("d", "article")];
      return [];
    });
    const decideResourceRequest = vi.fn(async (type: string, slug: string) => (slug === "c" ? ({ kind: "not-found" } as const) : render(type, slug)));
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

  it("treats a per-type list the data layer answers null (a type that names no term) as empty", async () => {
    const params = await resourcePageParams({
      listRecentResources: async ({ type }) => (type === undefined ? [resource("a", "webinar")] : null),
      listTerms: async () => types({ webinar: 2, article: 1 }),
      decideResourceRequest: async (type, slug) => render(type, slug),
      warn: silent,
    });
    expect(slugs(params)).toEqual(["a"]);
  });

  it("never asks for a type whose slug is reserved or that has no published resource", async () => {
    const listRecentResources = vi.fn<(options: { type?: string; count: number }) => Promise<WpResource[]>>(async () => []);
    await resourcePageParams({
      listRecentResources,
      listTerms: async () => [...types({ webinar: 1, ebook: 0 }), { ...TYPES[0], id: 999, slug: "topic", count: 3 }],
      decideResourceRequest: async (type, slug) => render(type, slug),
      warn: silent,
    });
    expect(listRecentResources.mock.calls.map(([options]) => options.type)).toEqual([undefined, "webinar"]);
  });

  it("is [] with one warning when a list fails", async () => {
    const warn = vi.fn();
    const params = await resourcePageParams({
      listRecentResources: async ({ type }) => {
        if (type === "webinar") throw new CmsError("/wp/v2/resources", "status", "HTTP 502", 502);
        return [resource("a", "webinar")];
      },
      listTerms: async () => types({ webinar: 2 }),
      decideResourceRequest: async (type, slug) => render(type, slug),
      warn,
    });
    expect(params).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [string])[0]).toContain("HTTP 502");
  });

  it("skips a candidate whose decision fails and keeps the rest, with one warning that counts and names the first failure", async () => {
    vi.stubEnv("WP_API_URL", "https://cms.example/wp-json");
    const warn = vi.fn();
    const candidates = ["a", "b", "c", "d", "e"].map((slug) => resource(slug, "webinar"));
    const params = await resourcePageParams({
      listRecentResources: async ({ type }) => (type === undefined ? candidates : []),
      listTerms: async () => types({ webinar: 5 }),
      decideResourceRequest: async (type, slug) => {
        if (slug === "b") throw new CmsError("/wp/v2/resources", "status", "HTTP 503 (service_unavailable)", 503);
        if (slug === "d") throw new CmsError("/wp/v2/resources", "schema", "the body is not JSON", 200);
        return render(type, slug);
      },
      warn,
    });
    expect(slugs(params)).toEqual(["a", "c", "e"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [string])[0]).toBe(
      "prerender /resources/[type]/[slug]: 2 of 5 candidate paths could not be read and render on their first request (the first: CMS request to /wp/v2/resources failed: HTTP 503 (service_unavailable)); prerendering the other 3",
    );
  });

  it("is [] with one warning when more than half of the candidates fail, since the CMS is unwell", async () => {
    const warn = vi.fn();
    const candidates = ["a", "b", "c", "d", "e", "f"].map((slug) => resource(slug, "webinar"));
    const params = await resourcePageParams({
      listRecentResources: async ({ type }) => (type === undefined ? candidates : []),
      listTerms: async () => types({ webinar: 6 }),
      decideResourceRequest: async (type, slug) => {
        if (["b", "c", "d", "e"].includes(slug)) throw new CmsError("/wp/v2/resources", "status", "HTTP 500", 500);
        return render(type, slug);
      },
      warn,
    });
    expect(params).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [string])[0]).toContain("4 of 6 candidates could not be read");
    expect((warn.mock.calls[0] as [string])[0]).toContain("renders on its first request");
  });

  it("keeps the set when exactly half fail: the share must be exceeded", async () => {
    const candidates = ["a", "b", "c", "d"].map((slug) => resource(slug, "webinar"));
    const params = await resourcePageParams({
      listRecentResources: async ({ type }) => (type === undefined ? candidates : []),
      listTerms: async () => types({ webinar: 4 }),
      decideResourceRequest: async (type, slug) => {
        if (["b", "d"].includes(slug)) throw new CmsError("/wp/v2/resources", "status", "HTTP 500", 500);
        return render(type, slug);
      },
      warn: silent,
    });
    expect(slugs(params)).toEqual(["a", "c"]);
  });

  it("keeps the candidates decided within the budget when the CMS is slow, and starts no decision after it", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const candidates = Array.from({ length: 30 }, (_item, index) => resource(`slug-${index}`, "webinar"));
    const decided: string[] = [];
    const pending = resourcePageParams({
      listRecentResources: async ({ type }) => (type === undefined ? candidates : []),
      listTerms: async () => types({ webinar: 30 }),
      // Each decision takes 100 ms and eight run at once: 16 are decided at the
      // 250 ms deadline, 8 more are in flight, and 6 have not started.
      decideResourceRequest: async (type, slug) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        decided.push(slug);
        return render(type, slug);
      },
      timeoutMs: 250,
      warn,
    });
    await vi.advanceTimersByTimeAsync(250);
    const params = await pending;
    expect(params).toHaveLength(16);
    expect(slugs(params)).toEqual(candidates.slice(0, 16).map((candidate) => candidate.slug));
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [string])[0]).toContain("prerendering the 16 paths that answered");
    // The eight in flight at the deadline finish; the six after them never start.
    await vi.advanceTimersByTimeAsync(1000);
    expect(decided).toHaveLength(24);
  });

  it("runs under the resource route's own budget", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const pending = resourcePageParams({
      listRecentResources: () => new Promise<never>(() => {}),
      listTerms: () => new Promise<never>(() => {}),
      warn,
    });
    await vi.advanceTimersByTimeAsync(RESOURCE_PRERENDER_TIMEOUT_MS - 1);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("typeListingParams", () => {
  it("is each offered type whose first page loads, decoded as a param", async () => {
    const loadListing = vi.fn(async ({ filter }: { filter: { type?: string } }) => (filter.type === "podcast" ? null : ({} as never)));
    const params = await typeListingParams({
      listTerms: async () => [...types({ webinar: 2, podcast: 1, article: 3, ebook: 0 }), { ...TYPES[0], id: 998, slug: "%e6%97%a5", count: 1 }],
      loadListing,
      warn: silent,
    });
    expect(params).toEqual([{ type: "article" }, { type: "webinar" }, { type: "日" }]);
    expect(loadListing.mock.calls.map(([valid]) => valid)).toEqual([
      { filter: { type: "article" }, page: 1 },
      { filter: { type: "podcast" }, page: 1 },
      { filter: { type: "webinar" }, page: 1 },
      { filter: { type: "%e6%97%a5" }, page: 1 },
    ]);
  });

  it("leaves out a type whose slug decodes to a slash or a space, without reading its listing", async () => {
    const loadListing = vi.fn<(valid: { filter: { type?: string }; page: number }) => Promise<never>>(async () => ({}) as never);
    const params = await typeListingParams({
      listTerms: async () => [
        ...types({ webinar: 1 }),
        { ...TYPES[0], id: 996, slug: "a%2fb", count: 1 },
        { ...TYPES[0], id: 997, slug: "a%20b", count: 1 },
      ],
      loadListing,
      warn: silent,
    });
    expect(params).toEqual([{ type: "webinar" }]);
    expect(loadListing.mock.calls.map(([valid]) => valid.filter.type)).toEqual(["webinar"]);
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
