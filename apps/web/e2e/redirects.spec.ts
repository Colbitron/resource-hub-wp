import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { E2E_REVALIDATE_SECRET } from "./mock-cms/config.mts";

/**
 * The resource page's redirects (`lib/redirects.ts`) against the built app
 * and the mock CMS, through the test-only page at
 * `/fixtures/redirect/[type]/[slug]/` (app/fixtures/redirect/…). The contract
 * (root `CLAUDE.md`, "Public URLs"; ADRs 0025 and 0035): a wrong type
 * segment, a non-canonical segment or an old slug gets one computed 308 to
 * the canonical URL, which answers 200, with `Cache-Control: no-store`, and
 * a type changed and changed back never serves a cached redirect.
 *
 * Every hop is requested with `maxRedirects: 0`, so each response is seen as
 * sent. `expectRedirect` is the one place a redirect is asserted: the
 * status, the `Location`, the cache header, that nothing marks it as served
 * from the route cache, and that the target answers 200 without redirecting
 * again. Changes to the mock are followed by the revalidation event the CMS
 * would send, because the app's Data Cache does not see the mock change
 * (e2e/README.md).
 */

const PREFIX = "/fixtures/redirect";
const ROUTE = "/api/revalidate/";
/** A seeded webinar (ID 33) with a rich body. */
const SEEDED = { id: 33, type: "webinar", slug: "revalidation-from-the-editors-chair" };

const cms = mockCms();

/**
 * Resources a test creates get a slug of their own for this run. The app's
 * Data Cache outlives the mock's reset and, on disk under `.next/cache`, the
 * app process too, so a slug reused from an earlier run would be answered
 * from a cached lookup, a hit or a miss, rather than from the mock
 * (e2e/README.md).
 */
const RUN = `${Date.now().toString(36)}`;

function unique(slug: string): string {
  return `${slug}-${RUN}`;
}

test.beforeEach(async () => {
  await cms.reset();
});

function fixturePath(type: string, slug: string): string {
  return `${PREFIX}/${type}/${slug}/`;
}

function get(request: APIRequestContext, path: string): Promise<APIResponse> {
  return request.get(path, { maxRedirects: 0 });
}

/** The `Cache-Control` directives of a response, lower-cased and trimmed. */
function cacheDirectives(response: APIResponse): string[] {
  return (response.headers()["cache-control"] ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .filter((directive) => directive !== "");
}

async function expectOk(request: APIRequestContext, path: string): Promise<APIResponse> {
  const response = await get(request, path);
  expect(response.status(), `${path} should answer 200`).toBe(200);
  expect(response.headers().location).toBeUndefined();
  return response;
}

/** One 308 from `from` to `to`, with `no-store`, not from a route cache, and `to` a 200: a single hop. */
async function expectRedirect(request: APIRequestContext, from: string, to: string): Promise<void> {
  const first = await get(request, from);
  expect(first.status(), `${from} should redirect`).toBe(308);
  expect(first.headers().location).toBe(to);
  expect(cacheDirectives(first)).toContain("no-store");
  expect(cacheDirectives(first).some((directive) => directive.startsWith("s-maxage"))).toBe(false);
  expect(first.headers()["x-nextjs-cache"]).toBeUndefined();
  await expectOk(request, to);
}

async function expectNotFound(request: APIRequestContext, path: string): Promise<void> {
  const response = await get(request, path);
  expect(response.status(), `${path} should be a 404`).toBe(404);
}

interface PreviousState {
  slug?: string;
  type?: string;
}

/** A schema-valid `update` event for resource `id` in its current state, with `previous` as given. */
async function updateEvent(id: number, previous: PreviousState) {
  const { origin, resources } = await cms.state();
  const resource = resources.find((candidate) => candidate.id === id);
  if (resource === undefined || resource.type === null) throw new Error(`the mock has no typed resource ${id}`);
  return {
    type: "resource",
    event: "update",
    id,
    slug: resource.slug,
    rest_url: `${origin}/wp-json/wp/v2/resources/${id}`,
    types: [resource.type],
    topics: resource.topics,
    previous: { slug: previous.slug ?? resource.slug, types: [previous.type ?? resource.type], topics: resource.topics },
  };
}

/** Sends `events` to the revalidate route as the CMS would, and expects a 200. */
async function revalidate(request: APIRequestContext, events: unknown[]): Promise<void> {
  const response = await request.post(ROUTE, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
    data: JSON.stringify({ version: 1, events }),
  });
  expect(response.status(), await response.text()).toBe(200);
}

test("the canonical URL renders the resource", async ({ request }) => {
  const response = await expectOk(request, fixturePath(SEEDED.type, SEEDED.slug));
  const html = await response.text();
  expect(html).toContain('data-testid="fixture-title">Revalidation from the editor’s chair<');
  expect(html).toContain(`>${fixturePath(SEEDED.type, SEEDED.slug)}<`);
});

test("a wrong type segment is one 308 to the canonical URL", async ({ request }) => {
  await expectRedirect(request, fixturePath("podcast", SEEDED.slug), fixturePath(SEEDED.type, SEEDED.slug));
  // Any type slug the plugin accepts, known or not: the slug is the identity.
  await expectRedirect(request, fixturePath("no-such-type", SEEDED.slug), fixturePath(SEEDED.type, SEEDED.slug));
});

test("a renamed slug is one 308 from the old slug to the new", async ({ request }) => {
  const before = unique("rename-me-before");
  const after = unique("rename-me-after");
  const { id } = await cms.createResource({ title: "Rename me", type: "article", slug: before });
  await expectOk(request, fixturePath("article", before));

  await cms.renameSlug(id, after);
  await revalidate(request, [await updateEvent(id, { slug: before })]);

  await expectRedirect(request, fixturePath("article", before), fixturePath("article", after));
  // The old slug under a wrong type still lands on the one canonical URL.
  await expectRedirect(request, fixturePath("webinar", before), fixturePath("article", after));
});

test("a type changed and changed back never serves a cached redirect", async ({ request }) => {
  const slug = unique("round-trip");
  const { id } = await cms.createResource({ title: "Round trip", type: "webinar", slug });
  const asWebinar = fixturePath("webinar", slug);
  const asPodcast = fixturePath("podcast", slug);
  await expectOk(request, asWebinar);
  await expectRedirect(request, asPodcast, asWebinar);

  // webinar -> podcast: the old URL redirects to the new one.
  await cms.setType(id, "podcast");
  await revalidate(request, [await updateEvent(id, { type: "webinar" })]);
  await expectRedirect(request, asWebinar, asPodcast);

  // podcast -> webinar: the original URL is a 200 again, and the middle URL redirects back.
  await cms.setType(id, "webinar");
  await revalidate(request, [await updateEvent(id, { type: "podcast" })]);
  await expectOk(request, asWebinar);
  await expectRedirect(request, asPodcast, asWebinar);
});

test("a segment in mixed case is one 308 to the lower-case URL", async ({ request }) => {
  const canonical = fixturePath(SEEDED.type, SEEDED.slug);
  await expectRedirect(request, fixturePath("Webinar", SEEDED.slug), canonical);
  await expectRedirect(request, fixturePath(SEEDED.type, "Revalidation-From-The-Editors-Chair"), canonical);
  // Wrong type and mixed case together: still one hop.
  await expectRedirect(request, fixturePath("PODCAST", "Revalidation-From-The-Editors-Chair"), canonical);
  // An upper-case letter hidden in an escape: Next.js decodes `%52` to `R` before the page sees it.
  await expectRedirect(request, fixturePath(SEEDED.type, "%52evalidation-from-the-editors-chair"), canonical);
});

test("a percent-encoded slug renders in either hex case, with no redirect to loop through", async ({ request }) => {
  // WordPress stores a non-ASCII slug percent-encoded in lower case; browsers and
  // Next.js present the escapes in upper case, so both forms must render as is.
  const { slug } = await cms.createResource({ title: `日本語の記事 ${RUN}`, type: "article" });
  expect(slug).toMatch(/^%[0-9a-f]{2}/);
  // The same escapes with upper-case hex, as a browser sends them; the letters of the run suffix stay as they are.
  const upperHex = slug.replace(/%[0-9a-f]{2}/g, (escape) => escape.toUpperCase());
  expect(upperHex).not.toBe(slug);
  await expectOk(request, fixturePath("article", slug));
  await expectOk(request, fixturePath("article", upperHex));
  // The type segment in mixed case still redirects, to the lower-case encoded slug.
  await expectRedirect(request, fixturePath("Article", upperHex), fixturePath("article", slug));
});

test("an unknown slug, a reserved type and an invalid slug are 404s", async ({ request }) => {
  await expectNotFound(request, fixturePath("webinar", unique("no-such-resource")));
  await expectNotFound(request, fixturePath("no-such-type", unique("no-such-resource")));
  // `topic` and `page` are route segments, never a type, in any case.
  await expectNotFound(request, fixturePath("topic", SEEDED.slug));
  await expectNotFound(request, fixturePath("Page", SEEDED.slug));
  // Longer than any slug WordPress can store: refused before any lookup.
  await expectNotFound(request, fixturePath("webinar", "a".repeat(201)));
});

test("a slug that is found never asks the resolve route", async ({ request }) => {
  await cms.resetRequests();
  await expectRedirect(request, fixturePath("podcast", SEEDED.slug), fixturePath(SEEDED.type, SEEDED.slug));
  const { byPath } = await cms.requests();
  // The slug lookup is in the Data Cache from the earlier tests or made once here; resolve is for a miss only.
  expect(Object.keys(byPath).some((path) => path.includes("/resource-hub/v1/resolve"))).toBe(false);
});
