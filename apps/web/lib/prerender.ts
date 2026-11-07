import "server-only";

import { loadListing } from "./listing-data";
import { decidePageRequest } from "./page-request";
import { decideResourceRequest } from "./redirects";
import { canonicalSlug, isTypeSlug } from "./routes";
import { resourceType } from "./wp/cards";
import { scrubCmsHost } from "./wp/fetch";
import { listRecentResources } from "./wp/resources";
import type { WpResource } from "./wp/schemas/rest";
import { listTerms } from "./wp/terms";

/**
 * What `next build` prerenders from the CMS, and the rule that the build can
 * never fail because of it (ADR 0053). Each `generateStaticParams` under
 * `app/` calls one function here; the function makes the page's own reads
 * through the data layer, under a time budget, and returns the params whose
 * reads succeeded, or `[]` on any failure, so that:
 *
 * - a page the build prerenders is rendered from reads already in the Data
 *   Cache (every data-layer read is a `fetch` with `cache: "force-cache"`),
 *   so the render that follows the probe makes no new request and cannot
 *   fail on one;
 * - a CMS that is absent (the `cms.example` placeholder CI builds with),
 *   down, slow or answering something the reader schemas refuse costs one
 *   build warning per route and no prerendered page: the route then renders
 *   each path on its first request, which is what every route did before.
 *
 * Why these pages and no others: the prerendered set is what a reader is
 * most likely to open first and what the client router needs in the build's
 * prefetch-hint manifest for row prefetch to work (ADR 0053). The library's
 * first page, each type's first page and the site's root are the entries to
 * the library; the `RECENT_RESOURCES` newest resources and the
 * `RECENT_PER_TYPE` newest of each type are the rows those pages show. Topic
 * listings and later pages grow with what editors add and are left to ISR
 * (ADR 0043's "prerender every listing", still rejected). Every route keeps
 * `dynamicParams` on, its `revalidate` and its tags, so a prerendered page
 * and one rendered on demand are stored, served and cleared the same way;
 * `generateStaticParams` is not run again at revalidation, so the set is the
 * build's and changes on the next deploy.
 *
 * Each function is also pure enough to test without Next.js: the selection
 * is `selectResourceParams`, and the reads are injected through `options`.
 */

/** How many of the newest published resources the build prerenders, across every type. */
export const RECENT_RESOURCES = 50;

/** How many of the newest published resources of each type the build prerenders. */
export const RECENT_PER_TYPE = 10;

/**
 * The time one route's `generateStaticParams` may spend asking the CMS, in
 * milliseconds, after which it gives up and returns `[]`. Each request has
 * its own `CMS_TIMEOUT_MS` (10 s), so this bounds a CMS that answers each
 * request slowly rather than one that hangs; with four routes probing, a slow
 * CMS costs the build at most four of these, and never a failure.
 */
export const PRERENDER_TIMEOUT_MS = 10_000;

/**
 * How many CMS reads a probe keeps in flight at once. The candidate list is
 * up to 100 slugs (50 plus 10 for each of five types, before the union), and
 * a burst of that many requests at a small WordPress host would be a load
 * test, not a build; eight at a time keeps the probe within a few seconds
 * against a healthy CMS while asking no more of it than a handful of readers.
 */
export const PROBE_CONCURRENCY = 8;

/** `items.map(fn)`, awaited with at most `limit` calls in flight, results in the items' order. */
export async function mapConcurrently<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** A `resource_type` slug and a resource slug, both canonical: the params of `/resources/[type]/[slug]/`. */
export interface ResourceParams {
  readonly type: string;
  readonly slug: string;
}

/**
 * The params for `recent` (the newest resources across types, newest first)
 * and then for each type's list in `byType`, in the map's order, each slug
 * once, the first occurrence deciding its place. A resource without exactly
 * one embedded type the routes can serve (`resourceType`) has no URL and is
 * left out; a type listed under one slug in `byType` is checked against the
 * resource's own embedded type, which is what its URL is built from, so a
 * list the CMS filtered by a term the resource no longer carries cannot
 * produce a path that would redirect.
 */
export function selectResourceParams(
  recent: readonly WpResource[],
  byType: ReadonlyMap<string, readonly WpResource[]>,
): ResourceParams[] {
  const seen = new Set<string>();
  const params: ResourceParams[] = [];
  for (const resource of [...recent, ...[...byType.values()].flat()]) {
    const type = resourceType(resource);
    if (type === null) {
      continue;
    }
    const slug = canonicalSlug(resource.slug);
    if (seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    params.push({ type: canonicalSlug(type.slug), slug });
  }
  return params;
}

/** A read of the CMS a probe depends on, replaceable in tests. */
export interface PrerenderOptions {
  readonly listRecentResources?: typeof listRecentResources;
  readonly listTerms?: typeof listTerms;
  readonly decideResourceRequest?: typeof decideResourceRequest;
  readonly decidePageRequest?: typeof decidePageRequest;
  readonly loadListing?: typeof loadListing;
  /** The time budget; `PRERENDER_TIMEOUT_MS` by default. */
  readonly timeoutMs?: number;
  /** Where the one warning goes; `console.warn` by default. */
  readonly warn?: (message: string) => void;
}

/**
 * Runs `probe` for the route `route` under the time budget and returns what
 * it gives, or `[]` with one warning when it throws, times out or the CMS is
 * not configured (an `EnvError` from `lib/env.ts`). The warning names the
 * route and the failure's message, scrubbed of the CMS host as every
 * data-layer message is, and says what happens instead. Never throws, so
 * `next build` never fails here.
 */
export async function prerenderParams<T>(route: string, probe: () => Promise<T[]>, options: PrerenderOptions = {}): Promise<T[]> {
  const { timeoutMs = PRERENDER_TIMEOUT_MS, warn = console.warn } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from the CMS within ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([probe(), timeout]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warn(scrubCmsHost(`prerender ${route}: nothing prerendered at build, so each path renders on its first request; ${detail}`));
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The params of the resource pages the build prerenders: the union of the
 * `RECENT_RESOURCES` newest resources and the `RECENT_PER_TYPE` newest of
 * each type the filter bar offers (a type term with a published resource),
 * each slug once (`selectResourceParams`). Each candidate is then put through
 * the route's own decision (`decideResourceRequest`), which reads the slug
 * into the Data Cache for the render that follows, and only a `render`
 * decision is kept: a resource the lists name but the slug lookup cannot
 * find, or whose canonical URL differs, is left to ISR rather than
 * prerendered as a 404 or a 308. Any failure is `[]`.
 */
export async function resourcePageParams(options: PrerenderOptions = {}): Promise<ResourceParams[]> {
  const {
    listRecentResources: recentResources = listRecentResources,
    listTerms: terms = listTerms,
    decideResourceRequest: decide = decideResourceRequest,
  } = options;
  return prerenderParams(
    "/resources/[type]/[slug]",
    async () => {
      const [recent, types] = await Promise.all([recentResources({ count: RECENT_RESOURCES }), terms("resource_type")]);
      const offered = types.filter((type) => type.count > 0 && isTypeSlug(type.slug));
      const perType = await mapConcurrently(
        offered,
        PROBE_CONCURRENCY,
        async (type) => [type.slug, (await recentResources({ type: type.slug, count: RECENT_PER_TYPE })) ?? []] as const,
      );
      const candidates = selectResourceParams(recent ?? [], new Map(perType));
      const decisions = await mapConcurrently(candidates, PROBE_CONCURRENCY, (params) => decide(params.type, params.slug));
      return candidates.filter((_params, index) => decisions[index].kind === "render");
    },
    options,
  );
}

/**
 * The params of the type listings the build prerenders: the first page of
 * each type the filter bar offers, read through `loadListing` so the render
 * finds its reads in the Data Cache; a type whose listing is a 404 is left
 * out. Any failure is `[]`.
 */
export async function typeListingParams(options: PrerenderOptions = {}): Promise<{ type: string }[]> {
  const { listTerms: terms = listTerms, loadListing: load = loadListing } = options;
  return prerenderParams(
    "/resources/[type]",
    async () => {
      const types = (await terms("resource_type")).filter((type) => type.count > 0 && isTypeSlug(type.slug));
      const loaded = await mapConcurrently(types, PROBE_CONCURRENCY, (type) => load({ filter: { type: type.slug }, page: 1 }));
      return types.filter((_type, index) => loaded[index] !== null).map((type) => ({ type: canonicalSlug(type.slug) }));
    },
    options,
  );
}

/**
 * The library's first page, `/resources/`, as the optional catch-all's one
 * param (`rest: []`), when `loadListing` answers for it at build; `[]`
 * otherwise, and the page renders on its first request as before.
 */
export async function libraryParams(options: PrerenderOptions = {}): Promise<{ rest: string[] }[]> {
  const { loadListing: load = loadListing } = options;
  return prerenderParams(
    "/resources/[[...rest]]",
    async () => ((await load({ filter: {}, page: 1 })) === null ? [] : [{ rest: [] }]),
    options,
  );
}

/**
 * The site's root, `/`, as the pages catch-all's one param (`path: []`),
 * when the page decision for it at build is a page to render or the welcome
 * page; a redirect or a 404 at the root is not prerendered, and neither is
 * any other CMS page. Any failure is `[]`.
 */
export async function rootPageParams(options: PrerenderOptions = {}): Promise<{ path: string[] }[]> {
  const { decidePageRequest: decide = decidePageRequest } = options;
  return prerenderParams(
    "/[[...path]]",
    async () => {
      const decision = await decide([]);
      return decision.kind === "render" || decision.kind === "welcome" ? [{ path: [] }] : [];
    },
    options,
  );
}
