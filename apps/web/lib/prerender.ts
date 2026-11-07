import "server-only";

import { loadListing } from "./listing-data";
import { decidePageRequest } from "./page-request";
import { decideResourceRequest } from "./redirects";
import { canonicalSlug, isSlug, isTypeSlug } from "./routes";
import { resourceType } from "./wp/cards";
import { scrubCmsHost } from "./wp/fetch";
import { listRecentResources } from "./wp/resources";
import type { WpResource } from "./wp/schemas/rest";
import { listTerms } from "./wp/terms";

/**
 * What `next build` prerenders from the CMS, and the rule that the build can
 * never fail because of it (ADR 0043). Each `generateStaticParams` under
 * `app/` calls one function here; the function makes the page's own reads
 * through the data layer, under a time budget, and returns the params whose
 * reads succeeded, or `[]` on any failure, so that:
 *
 * - a page the build prerenders is rendered from reads already in the Data
 *   Cache (every data-layer read is a `fetch` with `cache: "force-cache"`,
 *   and the `build` script empties the cache first so the probe's reads are
 *   live, `scripts/clear-fetch-cache.mts`), so the render that follows the
 *   probe asks the CMS for nothing that succeeded. The one read a render can
 *   repeat is the library's lead, whose failure the listing contains: a lead
 *   read that failed in the probe is not cached, is asked again in the
 *   render, and fails the same way, without a request the page depends on;
 * - a CMS that is absent (the `cms.example` placeholder CI builds with),
 *   down, slow or answering something the reader schemas refuse costs one
 *   build warning per route and no prerendered page: the route then renders
 *   each path on its first request, which is what every route did before.
 *   A CMS that answers some reads within the budget and not the rest gets
 *   the paths that answered (`ProbeContext.partial`), and one whose answer
 *   for a few resources fails gets the rest (`ProbeContext.failures`), up
 *   to `MAX_FAILED_SHARE` of them.
 *
 * Why these pages and no others: the prerendered set is what a reader is
 * most likely to open first and what the client router needs in the build's
 * prefetch-hint manifest for row prefetch to work (ADR 0043). The library's
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
 * The time a route's `generateStaticParams` may spend asking the CMS, in
 * milliseconds, after which it keeps what has answered and gives up on the
 * rest. Each request has its own `CMS_TIMEOUT_MS` (10 s), so this bounds a
 * CMS that answers each request slowly rather than one that hangs. The
 * library, the type listings and the root make a handful of reads each, so
 * ten seconds is generous for them; with four routes probing, a slow CMS
 * costs the build at most the four budgets, and never a failure.
 */
export const PRERENDER_TIMEOUT_MS = 10_000;

/**
 * The resource route's budget: its probe makes up to a hundred reads (the
 * two lists, one slug lookup per candidate), `PROBE_CONCURRENCY` at a time,
 * so at a second a request it needs about thirteen seconds against a cold
 * CMS and about four against a warm one. Thirty seconds lets a slow CMS
 * finish, and when it cannot, the candidates decided by then are kept.
 */
export const RESOURCE_PRERENDER_TIMEOUT_MS = 30_000;

/**
 * The share of the resource probe's candidates whose decision may fail
 * before the probe gives the whole set up. One failed slug lookup is one
 * bad object or a hiccup, and the other pages are no worse for it; when more
 * than half fail, the CMS is unwell, and prerendering what happened to
 * answer would store pages from a session the next request may not repeat,
 * so the route falls back to `[]` and renders everything on demand, as
 * before. Half, because a lower share would give up the set over the kind
 * of partial outage a few resources can have on their own (a broken embed,
 * a plugin error on one post), and a higher one would keep prerendering
 * through an outage.
 */
export const MAX_FAILED_SHARE = 0.5;

/**
 * How many CMS reads a probe keeps in flight at once. The candidate list is
 * up to 100 slugs (50 plus 10 for each of five types, before the union), and
 * a burst of that many requests at a small WordPress host would be a load
 * test, not a build; eight at a time keeps the probe within a few seconds
 * against a healthy CMS while asking no more of it than a handful of readers.
 */
export const PROBE_CONCURRENCY = 8;

/** A flag the probe's loops check, set when the probe has finished, failed or run out of time. */
export interface Stop {
  stopped: boolean;
}

/**
 * `items.map(fn)`, awaited with at most `limit` calls in flight, results in
 * the items' order. Once `stop.stopped` is set no further call starts, so a
 * probe that has timed out or thrown does not keep reading the CMS; the
 * calls already in flight run to their end. A missing result (an item never
 * started) is `undefined`, so a caller that stops early reads the array
 * with that in mind.
 */
export async function mapConcurrently<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  stop: Stop = { stopped: false },
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array<R | undefined>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (!stop.stopped && next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** A `resource_type` slug and a resource slug, as Next.js takes them in `params`: the params of `/resources/[type]/[slug]/`. */
export interface ResourceParams {
  readonly type: string;
  readonly slug: string;
}

/**
 * The form a slug takes as a `generateStaticParams` value: its canonical
 * form, decoded. Next.js `encodeURIComponent`s each param when it builds the
 * path, so a stored slug passed as WordPress writes it (`%e6%97%a5-guide`)
 * would be prerendered at `%25e6…` and never match its own URL; decoded
 * (`日-guide`) it is encoded back once and keyed by the decoded path, which
 * is how the server keys every request (measured 2026-11-07; see
 * `docs/architecture/caching.md`, "Prefetching"). `null` for a slug whose
 * escapes are not UTF-8 (`%ff`), which has no form Next.js can encode and
 * which WordPress never writes, and for one whose decoded form is not a
 * slug the routes would accept (`a%2fb` decodes to `a/b`, `a%20b` to
 * `a b`; `isSlug`, with `isTypeSlug` for a type): such a path would be a
 * 404 or fail to build, and the stored form is its own URL, which ISR
 * answers on request as before.
 */
export function paramValue(slug: string, kind: "slug" | "type" = "slug"): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(canonicalSlug(slug));
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
  return (kind === "type" ? isTypeSlug(decoded) : isSlug(decoded)) ? decoded : null;
}

/**
 * The params for `recent` (the newest resources across types, newest first)
 * and then for each type's list in `byType`, in the map's order, each slug
 * once, the first occurrence deciding its place. A resource without exactly
 * one embedded type the routes can serve (`resourceType`) has no URL and is
 * left out, as is one whose slug or type `paramValue` cannot decode; a type
 * listed under one slug in `byType` is checked against the resource's own
 * embedded type, which is what its URL is built from, so a list the CMS
 * filtered by a term the resource no longer carries cannot produce a path
 * that would redirect.
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
    const slug = paramValue(resource.slug);
    const typeParam = paramValue(type.slug, "type");
    if (slug === null || typeParam === null || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    params.push({ type: typeParam, slug });
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
  /** The time budget; each probe's own constant by default. */
  readonly timeoutMs?: number;
  /** Where the one warning goes; `console.warn` by default. */
  readonly warn?: (message: string) => void;
}

/** What a probe is given: the stop flag for its loops, the list to put each param in as soon as it is decided, and the failures it chose to skip. */
export interface ProbeContext<T> {
  readonly stop: Stop;
  /** Every param whose reads have succeeded so far; what the route gets when the budget runs out. */
  readonly partial: T[];
  /** The message of each candidate's read the probe skipped rather than failed on; named in the one warning. */
  readonly failures: string[];
}

/**
 * Runs `probe` for the route `route` under the time budget and returns what
 * it gives, with one warning naming the candidates it skipped (`failures`)
 * when there were any; when the budget runs out first, the params decided by
 * then (`partial`), with one warning saying how many were kept; when it
 * throws, `[]` with one warning. A missing `WP_API_URL` (an `EnvError` from
 * `lib/env.ts`) is a throw like any other. The warning names the route and
 * the failure's message, scrubbed of the CMS host as every data-layer
 * message is, and says what happens instead. The stop flag is set on every
 * exit, so a probe's loops start no further read. Never throws, so
 * `next build` never fails here.
 */
export async function prerenderParams<T>(
  route: string,
  probe: (context: ProbeContext<T>) => Promise<T[]>,
  timeoutMs: number,
  options: PrerenderOptions = {},
): Promise<T[]> {
  const { warn = console.warn } = options;
  const budget = options.timeoutMs ?? timeoutMs;
  const context: ProbeContext<T> = { stop: { stopped: false }, partial: [], failures: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeout(budget)), budget);
  });
  try {
    const params = await Promise.race([probe(context), timeout]);
    if (context.failures.length > 0) {
      const skipped = context.failures.length;
      warn(
        scrubCmsHost(
          `prerender ${route}: ${skipped} of ${skipped + params.length} candidate ${skipped + params.length === 1 ? "path" : "paths"} could not be read and ${skipped === 1 ? "renders" : "render"} on ${skipped === 1 ? "its" : "their"} first request (the first: ${context.failures[0]}); prerendering the other ${params.length}`,
        ),
      );
    }
    return params;
  } catch (error) {
    if (error instanceof ProbeTimeout) {
      const kept = context.partial.length;
      warn(
        kept === 0
          ? `prerender ${route}: nothing prerendered at build, so each path renders on its first request; no answer from the CMS within ${budget} ms`
          : `prerender ${route}: the CMS did not answer everything within ${budget} ms; prerendering the ${kept} ${kept === 1 ? "path" : "paths"} that answered, and the rest render on their first request`,
      );
      return [...context.partial];
    }
    const detail = error instanceof Error ? error.message : String(error);
    warn(scrubCmsHost(`prerender ${route}: nothing prerendered at build, so each path renders on its first request; ${detail}`));
    return [];
  } finally {
    context.stop.stopped = true;
    clearTimeout(timer);
  }
}

class ProbeTimeout extends Error {
  constructor(budgetMs: number) {
    super(`no answer from the CMS within ${budgetMs} ms`);
    this.name = "ProbeTimeout";
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
 * prerendered as a 404 or a 308. A decision that throws (a 5xx for one
 * slug, one unreadable answer) skips that candidate and counts it in
 * `failures`, so one bad resource does not cost the set; when more than
 * `MAX_FAILED_SHARE` of the candidates fail the probe throws, and the route
 * is `[]`. Each kept candidate goes into `partial` as it is decided, so a
 * budget that runs out mid-way keeps those decided by then, in decision
 * order; a failure of the lists themselves is `[]`. The budget is
 * `RESOURCE_PRERENDER_TIMEOUT_MS`.
 */
export async function resourcePageParams(options: PrerenderOptions = {}): Promise<ResourceParams[]> {
  const {
    listRecentResources: recentResources = listRecentResources,
    listTerms: terms = listTerms,
    decideResourceRequest: decide = decideResourceRequest,
  } = options;
  return prerenderParams<ResourceParams>(
    "/resources/[type]/[slug]",
    async ({ stop, partial, failures }) => {
      const [recent, types] = await Promise.all([recentResources({ count: RECENT_RESOURCES }), terms("resource_type")]);
      const offered = types.filter((type) => type.count > 0 && isTypeSlug(type.slug));
      const perType = await mapConcurrently(
        offered,
        PROBE_CONCURRENCY,
        async (type) => [type.slug, (await recentResources({ type: type.slug, count: RECENT_PER_TYPE })) ?? []] as const,
        stop,
      );
      const candidates = selectResourceParams(recent ?? [], new Map(perType.filter((entry) => entry !== undefined)));
      await mapConcurrently(
        candidates,
        PROBE_CONCURRENCY,
        async (params) => {
          let decision;
          try {
            decision = await decide(params.type, params.slug);
          } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
            if (failures.length > candidates.length * MAX_FAILED_SHARE) {
              throw new Error(`${failures.length} of ${candidates.length} candidates could not be read, the first: ${failures[0]}`);
            }
            return;
          }
          if (decision.kind === "render") {
            partial.push(params);
          }
        },
        stop,
      );
      return [...partial];
    },
    RESOURCE_PRERENDER_TIMEOUT_MS,
    options,
  );
}

/**
 * The params of the type listings the build prerenders: the first page of
 * each type the filter bar offers, read through `loadListing` so the render
 * finds its reads in the Data Cache; a type whose listing is a 404, or whose
 * slug has no form the route accepts once decoded (`paramValue`), is left
 * out. Each type goes into `partial` as its page loads. Any failure is `[]`.
 */
export async function typeListingParams(options: PrerenderOptions = {}): Promise<{ type: string }[]> {
  const { listTerms: terms = listTerms, loadListing: load = loadListing } = options;
  return prerenderParams<{ type: string }>(
    "/resources/[type]",
    async ({ stop, partial }) => {
      const types = (await terms("resource_type")).filter((type) => type.count > 0 && isTypeSlug(type.slug));
      await mapConcurrently(
        types,
        PROBE_CONCURRENCY,
        async (type) => {
          const param = paramValue(type.slug, "type");
          if (param !== null && (await load({ filter: { type: type.slug }, page: 1 })) !== null) {
            partial.push({ type: param });
          }
        },
        stop,
      );
      return [...partial];
    },
    PRERENDER_TIMEOUT_MS,
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
  return prerenderParams<{ rest: string[] }>(
    "/resources/[[...rest]]",
    async () => ((await load({ filter: {}, page: 1 })) === null ? [] : [{ rest: [] }]),
    PRERENDER_TIMEOUT_MS,
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
  return prerenderParams<{ path: string[] }>(
    "/[[...path]]",
    async () => {
      const decision = await decide([]);
      return decision.kind === "render" || decision.kind === "welcome" ? [{ path: [] }] : [];
    },
    PRERENDER_TIMEOUT_MS,
    options,
  );
}
