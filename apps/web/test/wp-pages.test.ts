import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CmsError } from "../lib/wp/fetch";
import { getPageById, lookupPage } from "../lib/wp/pages";

/**
 * The page fetchers (ADR 0052) with `fetch` stubbed: the lookup's URL, query
 * and tag, what a miss and a hit come back as, what a bad answer does, and
 * the read by ID with its misses. The tag is `pages` on both.
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

const PAGE = {
  id: 14,
  slug: "team",
  link: "https://cms.example/about/team/",
  parent: 13,
  date_gmt: "2026-11-01T09:00:00",
  modified_gmt: "2026-11-02T10:00:00",
  title: { rendered: "Team" },
  content: { rendered: "<p>Us.</p>", protected: false },
  excerpt: { rendered: "<p>Who we are.</p>\n", protected: false },
  extra_field: "ignored",
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

describe("lookupPage", () => {
  it("asks the plugin's page route for the path, tagged pages, and returns the page", async () => {
    handler = () => json({ page: { id: 14, path: "/about/team/" } });
    expect(await lookupPage("/about/team/")).toEqual({ id: 14, path: "/about/team/" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.href).toBe(`${API}/resource-hub/v1/page?path=%2Fabout%2Fteam%2F`);
    expect(calls[0].init.next).toEqual({ revalidate: 3600, tags: ["pages"] });
    expect(calls[0].init.cache).toBe("force-cache");
  });

  it("returns null for a miss, which is a 200 the Data Cache keeps", async () => {
    handler = () => json({ page: null });
    expect(await lookupPage("/")).toBeNull();
    expect(calls[0].url.search).toBe("?path=%2F");
  });

  it("drops a key it does not know and keeps the rest", async () => {
    handler = () => json({ page: { id: 14, path: "/about/team/", slug: "team" }, version: 2 });
    expect(await lookupPage("/about/team/")).toEqual({ id: 14, path: "/about/team/" });
  });

  it("is null for the plugin's 400 on an over-long path and for a CMS without the route, and throws on anything else, never naming the CMS", async () => {
    handler = () => wpError(400, "rest_invalid_param");
    expect(await lookupPage(`/${"a".repeat(2011)}/`)).toBeNull();
    // A CMS a deploy behind, with no page route: the welcome page and 404s, not 500s.
    handler = () => wpError(404, "rest_no_route");
    expect(await lookupPage("/")).toBeNull();

    handler = () => json({ page: { id: 14, path: "/about/team.html/" } });
    const bad = await lookupPage("/about/").catch((error: unknown) => error);
    expect(bad).toBeInstanceOf(CmsError);
    expect((bad as CmsError).reason).toBe("schema");
    expect((bad as CmsError).message).not.toContain("cms.example");

    handler = () => wpError(500, "internal");
    const down = await lookupPage("/about/").catch((error: unknown) => error);
    expect(down).toBeInstanceOf(CmsError);
    expect((down as CmsError).message).not.toContain("cms.example");
  });
});

describe("getPageById", () => {
  it("reads /wp/v2/pages/{id}, tagged pages, and ignores unknown fields", async () => {
    handler = () => json(PAGE);
    const page = await getPageById(14);
    expect(page?.id).toBe(14);
    expect(page?.content).toEqual({ rendered: "<p>Us.</p>", protected: false });
    expect(page).not.toHaveProperty("extra_field");
    expect(calls[0].url.href).toBe(`${API}/wp/v2/pages/14`);
    expect(calls[0].init.next?.tags).toEqual(["pages"]);
  });

  it("is null for a non-ID without a request, and for core's 404 and 401", async () => {
    expect(await getPageById(0)).toBeNull();
    expect(await getPageById(1.5)).toBeNull();
    expect(calls).toHaveLength(0);
    handler = () => wpError(404, "rest_post_invalid_id");
    expect(await getPageById(99)).toBeNull();
    handler = () => wpError(401, "rest_forbidden");
    expect(await getPageById(99)).toBeNull();
  });

  it("throws when the body is another page or fails the schema", async () => {
    handler = () => json({ ...PAGE, id: 15 });
    await expect(getPageById(14)).rejects.toBeInstanceOf(CmsError);
    handler = () => json({ ...PAGE, title: "Team" });
    await expect(getPageById(14)).rejects.toBeInstanceOf(CmsError);
  });
});
