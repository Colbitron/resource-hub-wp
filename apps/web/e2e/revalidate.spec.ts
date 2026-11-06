import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { E2E_REVALIDATE_SECRET } from "./mock-cms/config.mts";
import { postRevalidate } from "./revalidation.mts";

/**
 * `POST /api/revalidate/` against the built app and the mock CMS: the
 * slash rule, the three answers the contract names (401, 400, 200), and an
 * end-to-end freshness check through `app/fixtures/revalidate/`, a test-only
 * page that makes one tagged, cached fetch of a seed resource. The mock
 * counts every request the app makes, so the spec can see when Next.js
 * served the Data Cache and when it went upstream.
 */

const ROUTE = "/api/revalidate/";
const FIXTURE_PATH = "/fixtures/revalidate/";
/** The resource the fixture page fetches; it is the article `alt-text-at-scale` in the seed. */
const FIXTURE_SLUG = "alt-text-at-scale";
/** The one path the mock counts for the fixture page's fetch. */
const FIXTURE_FETCH = `/wp-json/wp/v2/resources?slug=${FIXTURE_SLUG}&per_page=1&_embed`;

const cms = mockCms();

test.beforeEach(async () => {
  await cms.reset();
});

function headers(bearer: string | null = E2E_REVALIDATE_SECRET): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
  };
}

/** A schema-valid `update` for the seed resource, under its current state. */
async function updateEvent(id: number, slug: string, topics: string[]) {
  const { origin } = await cms.state();
  return {
    type: "resource",
    event: "update",
    id,
    slug,
    rest_url: `${origin}/wp-json/wp/v2/resources/${id}`,
    types: ["article"],
    topics,
    previous: { slug, types: ["article"], topics },
  };
}

/** POSTs `body` as JSON, or a string as its raw bytes (Playwright would otherwise JSON-encode a string under a JSON content type). */
function post(request: APIRequestContext, body: unknown, bearer?: string | null): Promise<APIResponse> {
  return postRevalidate(request, {
    headers: headers(bearer),
    data: typeof body === "string" ? Buffer.from(body, "utf8") : JSON.stringify(body),
  });
}

async function fixtureTitle(request: APIRequestContext): Promise<string> {
  const response = await request.get(FIXTURE_PATH);
  expect(response.status()).toBe(200);
  const html = await response.text();
  const match = /<h1 data-testid="fixture-title">([^<]*)<\/h1>/.exec(html);
  if (!match) throw new Error("the fixture page has no title");
  return match[1];
}

async function fixtureFetches(): Promise<number> {
  return (await cms.requests()).byPath[FIXTURE_FETCH] ?? 0;
}

test.describe("the path", () => {
  test("without the trailing slash is a 308 to the slashed path, which is why the plugin posts to /api/revalidate/", async ({
    request,
  }) => {
    // trailingSlash: true redirects every slashless path. A POST
    // that follows a 308 keeps its method and body, but the plugin's client
    // does not follow redirects on a POST, so it must post to the slash.
    const response = await request.post("/api/revalidate", {
      headers: headers(),
      data: "{}",
      maxRedirects: 0,
    });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toMatch(/\/api\/revalidate\/$/);
  });

  test("answers any other method with 405 and Allow: POST", async ({ request }) => {
    const response = await request.get(ROUTE);
    expect(response.status()).toBe(405);
    expect(response.headers()["allow"]).toBe("POST");
    expect(response.headers()["cache-control"]).toBe("no-store");
  });
});

test.describe("the contract's answers", () => {
  test("a wrong bearer is 401 { error: unauthorized }, and a missing one too", async ({ request }) => {
    const event = await updateEvent(21, FIXTURE_SLUG, ["accessibility", "editorial-workflow"]);
    for (const bearer of ["not-the-secret", "", null]) {
      const response = await post(request, { version: 1, events: [event] }, bearer);
      expect(response.status(), String(bearer)).toBe(401);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
  });

  test("a malformed body is 400 { error } with a plain message", async ({ request }) => {
    const notJson = await post(request, "{ not json");
    expect(notJson.status()).toBe(400);
    expect(await notJson.json()).toEqual({ error: "The body is not valid JSON." });

    const wrongVersion = await post(request, { version: 2, events: [] });
    expect(wrongVersion.status()).toBe(400);
    expect(await wrongVersion.json()).toEqual({
      error: "The body's version is not one this front end understands; it reads version 1.",
    });

    const badEvent = await post(request, {
      version: 1,
      events: [{ type: "resource", event: "archive", id: 1 }],
    });
    expect(badEvent.status()).toBe(400);
    const body = (await badEvent.json()) as { error: string };
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error).toMatch(/^The body does not match the revalidation request: events\[0\]/);
  });

  test("a valid batch is 200 { revalidated: [paths] }, the union of both states, slashed", async ({
    request,
  }) => {
    const event = await updateEvent(21, FIXTURE_SLUG, ["accessibility"]);
    event.previous = { slug: "alt-text", types: ["article"], topics: ["editorial-workflow"] };
    const response = await post(request, { version: 1, events: [event] });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({
      revalidated: [
        "/resources/",
        "/resources/article/",
        "/resources/article/alt-text-at-scale/",
        "/resources/article/alt-text/",
        "/resources/article/topic/accessibility/",
        "/resources/article/topic/editorial-workflow/",
        "/resources/topic/accessibility/",
        "/resources/topic/editorial-workflow/",
      ],
    });
    // The route fetched nothing from the CMS: not rest_url, not anything.
    const { byPath } = await cms.requests();
    expect(Object.keys(byPath).filter((path) => path.includes("/resources/21"))).toEqual([]);
    expect(byPath[FIXTURE_FETCH] ?? 0).toBe(0);
  });
});

test.describe("freshness end to end", () => {
  test("a cached fetch is served from the Data Cache until an update event clears its tag", async ({
    request,
  }) => {
    // Another test's load, or an earlier run's, may have primed the cache, so
    // clear the tag first and start from a known state.
    const prime = await post(request, {
      version: 1,
      events: [await updateEvent(21, FIXTURE_SLUG, ["accessibility", "editorial-workflow"])],
    });
    expect(prime.status()).toBe(200);
    await cms.resetRequests();

    // 1. Two loads, one upstream fetch: the second is served from the cache,
    //    although the mock answers with Cache-Control: no-cache (ADR 0043).
    expect(await fixtureTitle(request)).toBe("Alt text at scale");
    expect(await fixtureTitle(request)).toBe("Alt text at scale");
    expect(await fixtureFetches()).toBe(1);

    // 2. The CMS changes. The cache does not know, so the page is stale.
    await cms.setTitle(21, "Alt text at any scale");
    expect(await fixtureTitle(request)).toBe("Alt text at scale");
    expect(await fixtureFetches()).toBe(1);

    // 3. WordPress tells the front end.
    const response = await post(request, {
      version: 1,
      events: [await updateEvent(21, FIXTURE_SLUG, ["accessibility", "editorial-workflow"])],
    });
    expect(response.status()).toBe(200);

    // 4. The next load fetches again and shows the new title.
    expect(await fixtureTitle(request)).toBe("Alt text at any scale");
    expect(await fixtureFetches()).toBe(2);

    // And the one after it is cached again.
    expect(await fixtureTitle(request)).toBe("Alt text at any scale");
    expect(await fixtureFetches()).toBe(2);
  });

  test("an event for another resource leaves the cached fetch alone", async ({ request }) => {
    const prime = await post(request, {
      version: 1,
      events: [await updateEvent(21, FIXTURE_SLUG, ["accessibility", "editorial-workflow"])],
    });
    expect(prime.status()).toBe(200);
    await cms.resetRequests();

    expect(await fixtureTitle(request)).toBe("Alt text at scale");
    expect(await fixtureFetches()).toBe(1);

    // A different resource, with no term event: none of its tags is on the
    // fixture's fetch (`resource:alt-text-at-scale` and `terms`).
    const other = await updateEvent(22, "choosing-a-headless-architecture", ["headless-delivery"]);
    other.types = ["webinar"];
    other.previous = { slug: other.slug, types: ["webinar"], topics: ["headless-delivery"] };
    const response = await post(request, { version: 1, events: [other] });
    expect(response.status()).toBe(200);

    expect(await fixtureTitle(request)).toBe("Alt text at scale");
    expect(await fixtureFetches()).toBe(1);
  });
});
