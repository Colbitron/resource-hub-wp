import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

import { mockCms } from "./mock-cms/client.mts";
import { E2E_REVALIDATE_SECRET } from "./mock-cms/config.mts";

/**
 * The resource page's redirects (`lib/redirects.ts`) against the built app
 * and the mock CMS, through the test-only page at
 * `/fixtures/redirect/[type]/[slug]/` (app/fixtures/redirect/…). The contract
 * (ADR 0025; the URL shape is in `packages/ui/README.md`): a wrong type
 * segment, a non-canonical segment or an old slug gets one computed 308 to
 * the canonical URL, which answers 200, with a cache header that keeps a
 * browser from holding it, and a type changed and changed back never serves
 * a cached redirect.
 *
 * The fixture route renders on every request, so these tests cover the
 * decision's edge cases without a route cache in the way. It sits behind
 * the same proxy as every path (see `docs/architecture/caching.md`), so a
 * mixed-case segment gets the proxy's `no-store` 308 before the decision
 * runs, and under the catch-all's `headers()` rule, so the fixture's own
 * 308s carry `public, max-age=0, must-revalidate` in place of Next.js's
 * dynamic `no-store` (`sendRenderResult` keeps a header already set). The
 * real route is ISR and stores what it answers; `e2e/resource-page.spec.ts`
 * proves what it stores, what clears it, and that Chromium, whose cache
 * keeps a 308 that lacks a cache header for ever (ADR 0025), asks the server
 * again each time.
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

/**
 * One 308 from `from` to `to`, not from a route cache, with a header a
 * browser must ask again under (`no-store` from the proxy, `max-age=0` from
 * the fixture under the catch-all's header rule), and `to` a 200: a single
 * hop.
 */
async function expectRedirect(request: APIRequestContext, from: string, to: string): Promise<void> {
  const first = await get(request, from);
  expect(first.status(), `${from} should redirect`).toBe(308);
  expect(first.headers().location).toBe(to);
  const directives = cacheDirectives(first);
  expect(directives.includes("no-store") || directives.includes("max-age=0"), `${from}: ${directives.join(", ")}`).toBe(true);
  expect(directives.some((directive) => directive.startsWith("s-maxage"))).toBe(false);
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

test("a type changed and changed back: each step answers a fresh single-hop 308", async ({ request }) => {
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

/** One navigation's redirect, as Chromium's network layer reported it. */
interface BrowserHop {
  from: string;
  status: number;
  cacheControl: string;
  fromCache: boolean;
}

/**
 * Records every redirect Chromium follows on `page`, and whether its disk or
 * memory cache answered it instead of the server, from the DevTools protocol,
 * which reports a cached redirect that Playwright's events do not mark.
 */
async function watchRedirects(page: Page): Promise<BrowserHop[]> {
  const hops: BrowserHop[] = [];
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  session.on("Network.requestWillBeSent", (event) => {
    const redirect = event.redirectResponse;
    if (redirect === undefined) return;
    const cacheControl = Object.entries(redirect.headers).find(([name]) => name.toLowerCase() === "cache-control")?.[1] ?? "";
    hops.push({
      from: new URL(redirect.url).pathname,
      status: redirect.status,
      cacheControl: String(cacheControl),
      fromCache: redirect.fromDiskCache === true || redirect.fromPrefetchCache === true || redirect.fromServiceWorker === true,
    });
  });
  return hops;
}

/**
 * Navigates Chromium to `from` and expects it to land on `to` with the
 * resource's title, through at most one redirect that came from the server
 * with `no-store`, never from the browser's cache.
 */
async function expectBrowserLands(page: Page, hops: BrowserHop[], from: string, to: string, title: string): Promise<void> {
  hops.length = 0;
  const response = await page.goto(from);
  expect(new URL(page.url()).pathname, `${from} should land on ${to}`).toBe(to);
  expect(response?.status(), `${to} should answer 200`).toBe(200);
  await expect(page.getByTestId("fixture-title")).toHaveText(title);
  await expect(page.getByTestId("fixture-path")).toHaveText(to);
  expect(hops, `the redirects followed from ${from}`).toEqual(
    from === to ? [] : [{ from, status: 308, cacheControl: expect.stringMatching(/no-store|max-age=0/), fromCache: false }],
  );
}

test("in Chromium, a type changed and changed back lands on the current URL at every step", async ({ page, request }) => {
  const slug = unique("browser-round-trip");
  const title = `Browser round trip ${RUN}`;
  const { id } = await cms.createResource({ title, type: "webinar", slug });
  const asWebinar = fixturePath("webinar", slug);
  const asPodcast = fixturePath("podcast", slug);
  const hops = await watchRedirects(page);

  // As a webinar: the podcast URL redirects, and Chromium may not keep that redirect.
  await expectBrowserLands(page, hops, asWebinar, asWebinar, title);
  await expectBrowserLands(page, hops, asPodcast, asWebinar, title);

  // webinar -> podcast: a kept podcast -> webinar redirect would now loop.
  await cms.setType(id, "podcast");
  await revalidate(request, [await updateEvent(id, { type: "webinar" })]);
  await expectBrowserLands(page, hops, asPodcast, asPodcast, title);
  await expectBrowserLands(page, hops, asWebinar, asPodcast, title);

  // podcast -> webinar: a kept webinar -> podcast redirect would now loop.
  await cms.setType(id, "webinar");
  await revalidate(request, [await updateEvent(id, { type: "podcast" })]);
  await expectBrowserLands(page, hops, asWebinar, asWebinar, title);
  await expectBrowserLands(page, hops, asPodcast, asWebinar, title);
});

test("a segment in mixed case is one 308 from the proxy to the lower-case URL, before the decision runs", async ({ request }) => {
  const canonical = fixturePath(SEEDED.type, SEEDED.slug);
  await expectRedirect(request, fixturePath("Webinar", SEEDED.slug), canonical);
  await expectRedirect(request, fixturePath(SEEDED.type, "Revalidation-From-The-Editors-Chair"), canonical);
  // An upper-case letter hidden in an escape: the proxy decodes `%52` to `R` as Next.js would, and lower-cases it.
  await expectRedirect(request, fixturePath(SEEDED.type, "%52evalidation-from-the-editors-chair"), canonical);
  // Wrong type and mixed case together: the proxy lower-cases, then the decision redirects the type; two hops, each a decision of its own.
  const first = await get(request, fixturePath("PODCAST", "Revalidation-From-The-Editors-Chair"));
  expect(first.status()).toBe(308);
  expect(first.headers().location).toBe(fixturePath("podcast", SEEDED.slug));
  expect(cacheDirectives(first)).toContain("no-store");
  await expectRedirect(request, fixturePath("podcast", SEEDED.slug), canonical);
});

test("a percent-encoded slug renders in WordPress's lower-case hex, and upper-case hex is one hop to it", async ({ request }) => {
  // WordPress stores a non-ASCII slug percent-encoded in lower case; browsers and
  // Next.js present the escapes in upper case, so both forms must render as is.
  const { slug } = await cms.createResource({ title: `日本語の記事 ${RUN}`, type: "article" });
  expect(slug).toMatch(/^%[0-9a-f]{2}/);
  // The same escapes with upper-case hex, as a browser sends them; the letters of the run suffix stay as they are.
  const upperHex = slug.replace(/%[0-9a-f]{2}/g, (escape) => escape.toUpperCase());
  expect(upperHex).not.toBe(slug);
  await expectOk(request, fixturePath("article", slug));
  // Upper-case hex, as a browser sends it, gets the proxy's one hop to WordPress's lower-case form;
  // the page itself treats either hex case as canonical, so nothing can loop.
  await expectRedirect(request, fixturePath("article", upperHex), fixturePath("article", slug));
  await expectRedirect(request, fixturePath("Article", upperHex), fixturePath("article", slug));
});

test("an unknown slug, a reserved type and an invalid slug are 404s", async ({ request }) => {
  await expectNotFound(request, fixturePath("webinar", unique("no-such-resource")));
  await expectNotFound(request, fixturePath("no-such-type", unique("no-such-resource")));
  // `topic` and `page` are route segments, never a type, in any case (the proxy lower-cases `Page` first; the decision refuses either).
  await expectNotFound(request, fixturePath("topic", SEEDED.slug));
  await expectNotFound(request, fixturePath("page", SEEDED.slug));
  const capitalised = await get(request, fixturePath("Page", SEEDED.slug));
  expect(capitalised.status()).toBe(308);
  expect(capitalised.headers().location).toBe(fixturePath("page", SEEDED.slug));
  // Longer than any slug WordPress can store: refused before any lookup.
  await expectNotFound(request, fixturePath("webinar", "a".repeat(201)));
});

test("a type stored as arti%27cle is refused, never a redirect to its own URL", async ({ request }) => {
  // WordPress's `sanitize_title` keeps an escape an editor types, so a type term can be stored as
  // `arti%27cle`. Next.js decodes `%27` in params, so the page would see `arti'cle` and redirect to
  // `arti%27cle` for ever; the reader schema refuses the term instead (`slugProblem`).
  const ebook = (await cms.state()).terms.find((term) => term.taxonomy === "resource_type" && term.slug === "ebook");
  if (ebook === undefined) throw new Error("the mock has no ebook type");
  await cms.renameTerm("resource_type", ebook.id, { slug: "arti%27cle" });
  const slug = unique("quoted-type");
  const { id } = await cms.createResource({ title: "Quoted type", type: "arti%27cle", slug });

  // Typed as the CMS stores it, the proxy decodes `%27` as Next.js would and sends one hop to
  // the decoded path, where the slug lookup's body fails the reader schema and the page throws
  // a `CmsError`: a 500, never a redirect back to `arti%27cle`.
  for (const type of ["arti%27cle", "ARTI%27CLE"]) {
    const response = await get(request, fixturePath(type, slug));
    expect(response.status(), type).toBe(308);
    expect(response.headers().location, type).toBe(fixturePath("arti'cle", slug));
    expect(cacheDirectives(response), type).toContain("no-store");
  }
  for (const type of ["arti'cle", "webinar"]) {
    const response = await get(request, fixturePath(type, slug));
    expect(response.status(), `${type}: ${response.headers().location ?? ""}`).toBe(500);
    expect(response.headers().location, type).toBeUndefined();
  }

  // The event the CMS would send for it is refused too, with a message that names the escape.
  const event = { ...(await updateEvent(id, {})), previous: null, event: "publish" };
  const response = await request.post(ROUTE, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
    data: JSON.stringify({ version: 1, events: [event] }),
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("%27");
});

test("a slug that is found never asks the resolve route", async ({ request }) => {
  await cms.resetRequests();
  await expectRedirect(request, fixturePath("podcast", SEEDED.slug), fixturePath(SEEDED.type, SEEDED.slug));
  const { byPath } = await cms.requests();
  // The slug lookup is in the Data Cache from the earlier tests or made once here; resolve is for a miss only.
  expect(Object.keys(byPath).some((path) => path.includes("/resource-hub/v1/resolve"))).toBe(false);
});
