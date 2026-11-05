import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The data layer inside one render. Outside React Server Components, React's
 * `cache` memoizes nothing, so these tests stand it in with one that
 * memoizes by argument until `render.next()` starts a new render, as the
 * server's per-request scope does. They check that a list read twice in a
 * render (a page and its `generateMetadata`) is fetched, parsed and warned
 * about once (ADR 0049).
 */

const render = vi.hoisted(() => {
  const scopes = new Map<unknown, Map<string, unknown>>();
  return {
    /** Ends the current render: every memoized value is forgotten. */
    next(): void {
      scopes.clear();
    },
    cache<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
      return (...args: A): R => {
        let scope = scopes.get(fn);
        if (scope === undefined) {
          scope = new Map();
          scopes.set(fn, scope);
        }
        // The data layer's cached functions take strings or nothing.
        const key = JSON.stringify(args);
        if (!scope.has(key)) scope.set(key, fn(...args));
        return scope.get(key) as R;
      };
    },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: render.cache }));

const { CmsError } = await import("../lib/wp/fetch");
const { listResources } = await import("../lib/wp/resources");

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/wp");
const [FIRST] = JSON.parse(readFileSync(path.join(fixtures, "resources.list.json"), "utf8")) as Record<string, unknown>[];

/** `count` resources, the first `bad` of them without a title, which the reader schema refuses. */
function resources(count: number, bad: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => {
    const resource: Record<string, unknown> = { ...structuredClone(FIRST), id: 700 + index, slug: `resource-${index}` };
    if (index < bad) delete resource.title;
    return resource;
  });
}

let body: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  render.next();
  vi.stubEnv("WP_API_URL", "https://cms.example/wp-json");
  vi.stubEnv("WP_MEDIA_ORIGIN", "");
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-WP-Total": String(body.length), "X-WP-TotalPages": "1" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a list read twice in one render", () => {
  it("is fetched, parsed and warned about once, and again in the next render", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    body = resources(5, 1);

    // The page and its generateMetadata, at once and then again.
    const [page, metadata] = await Promise.all([listResources({ page: 1 }), listResources({ page: 1 })]);
    const later = await listResources({ page: 1 });
    expect(page).toMatchObject({ skipped: 1 });
    expect(metadata).toEqual(page);
    expect(later).toMatchObject({ skipped: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
      "CMS list /wp/v2/resources: skipped item 0 (ID 700), which fails the reader schema at title",
      "CMS list /wp/v2/resources: skipped 1 of 5",
    ]);

    render.next();
    await listResources({ page: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("throws the same error each time, warning about its items once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    body = resources(4, 3);

    const [first, second] = await Promise.allSettled([listResources({ page: 1 }), listResources({ page: 1 })]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("rejected");
    const error = (first as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(CmsError);
    expect((second as PromiseRejectedResult).reason).toBe(error);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
