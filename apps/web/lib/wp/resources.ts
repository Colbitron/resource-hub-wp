import "server-only";

import { canonicalSlug, isPageNumber, isSlug, isTypeSlug } from "../routes";
import { flagListingTags, listingTags, relatedTags, resourceByIdTags, resourceFetchTags } from "../tags";
import { CmsError, cmsGet, cmsGetList, cmsGetListOk, NO_SUCH_PAGE, readPagination, type NoSuchPage } from "./fetch";
import { wpResourceSchema, type WpResource } from "./schemas/rest";
import { getTermBySlug } from "./terms";

/**
 * Resources from `/wp/v2/resources`, always with `_embed`, which the reader
 * schema relies on for terms and the featured image: a page of a listing,
 * the most recent few for the build to prerender, one by slug, one by ID,
 * and several by ID in a given order.
 *
 * Every read of the collection is parsed per item (`cmsGetList` in
 * `fetch.ts`, whose docblock holds the rule): a resource the reader schema
 * refuses is left out with a warning, and an answer of four or more
 * resources in which more than half fail throws a `CmsError`. The read by
 * ID is one object and fails as a whole.
 */

/** Resources per listing page: divides into rows of two, three and four cards. */
export const RESOURCES_PER_PAGE = 12;

/** Core's largest `per_page`, and so the most IDs one `include` read can return. */
const MAX_INCLUDE = 100;

/** A WordPress post ID: a positive safe integer. */
function isPostId(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 1;
}

export interface ListResourcesOptions {
  /** A `resource_type` slug, as in the path. */
  readonly type?: string;
  /** A `resource_topic` slug, as in the path. */
  readonly topic?: string;
  /** A `resource_flag` slug, such as `featured`. */
  readonly flag?: string;
  /** 1 or more. */
  readonly page: number;
}

export interface ResourceListing {
  /** The page's resources that passed the reader schema, newest first; a skipped one leaves the page short. */
  readonly items: WpResource[];
  /** Resources across every page, as the CMS counts them, skipped ones included. */
  readonly total: number;
  /** Pages at `RESOURCES_PER_PAGE`; 0 when nothing matches. */
  readonly totalPages: number;
  /** Resources on this page the reader schema refused, each logged; no page shows it yet. */
  readonly skipped: number;
}

/** Each element once, in first-seen order. */
function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * One page of the listing for a type, a topic, a flag, any of them together
 * or none, newest first. Each slug is resolved to its term ID through
 * `getTermBySlug` first, because the REST filters take IDs.
 *
 * - `null` when a slug cannot be one or names no term: the page answers a
 *   404 through `DataNotFound`.
 * - `NO_SUCH_PAGE` when `page` is not a page number, or is past the last
 *   page: core's 400 `rest_post_invalid_page_number` when there is anything
 *   to page through, and an empty page past the first when there is not.
 *
 * Tagged from the request, before any lookup: `listingTags({ type, topic })`,
 * plus `flagListingTags()` with a flag.
 *
 * A resource the reader schema refuses is skipped (and logged), so the page
 * can hold fewer than `RESOURCES_PER_PAGE`, and `skipped` counts them;
 * `total` and `totalPages` are the CMS's headers, unchanged, so the page
 * numbers stay the CMS's. A page of four or more resources on which more
 * than half fail throws. A shorter page whose every resource fails, such as
 * a last page holding one bad resource, is an empty page within the CMS's
 * page count, not `NO_SUCH_PAGE`: the pagination the CMS reports still
 * links to it.
 */
export async function listResources(options: ListResourcesOptions): Promise<ResourceListing | NoSuchPage | null> {
  const { type, topic, flag, page } = options;
  if (!isPageNumber(page)) {
    return NO_SUCH_PAGE;
  }
  if (
    (type !== undefined && !isTypeSlug(type)) ||
    (topic !== undefined && !isSlug(topic)) ||
    (flag !== undefined && !isSlug(flag))
  ) {
    return null;
  }
  const tags = unique([...listingTags({ type, topic }), ...(flag === undefined ? [] : flagListingTags())]);

  const [typeTerm, topicTerm, flagTerm] = await Promise.all([
    type === undefined ? undefined : getTermBySlug("resource_type", type),
    topic === undefined ? undefined : getTermBySlug("resource_topic", topic),
    flag === undefined ? undefined : getTermBySlug("resource_flag", flag),
  ]);
  if (typeTerm === null || topicTerm === null || flagTerm === null) {
    return null;
  }

  const params = new URLSearchParams({ per_page: String(RESOURCES_PER_PAGE), page: String(page) });
  if (topicTerm !== undefined) params.set("resource_topic", String(topicTerm.id));
  if (typeTerm !== undefined) params.set("resource_type", String(typeTerm.id));
  if (flagTerm !== undefined) params.set("resource_flag", String(flagTerm.id));

  const path = "/wp/v2/resources";
  const result = await cmsGetList({
    path,
    query: `_embed&${params.toString()}`,
    tags,
    itemSchema: wpResourceSchema,
    outOfRange: [{ status: 400, code: "rest_post_invalid_page_number" }],
  });
  if (result.kind === NO_SUCH_PAGE) {
    return NO_SUCH_PAGE;
  }
  if (result.kind !== "ok") {
    throw new CmsError(path, "status", "an answer the request did not expect");
  }
  const { total, totalPages } = readPagination(path, result.headers);
  if (page > 1 && page > totalPages) {
    return NO_SUCH_PAGE;
  }
  return { items: result.data.items, total, totalPages, skipped: result.data.skipped };
}

export interface RecentResourcesOptions {
  /** A `resource_type` slug, as in the path; every type when left out. */
  readonly type?: string;
  /** How many, 1 to `MAX_INCLUDE` (core's largest `per_page`). */
  readonly count: number;
}

/**
 * The `count` most recently published resources, newest first, of one type
 * or of every type: what the build prerenders (`lib/prerender.ts`). One page
 * of `count` at `orderby=date&order=desc`, core's default order written out
 * so the request says what it asks for. The type slug is resolved to its term
 * ID first, as `listResources` does; a type that cannot be a type slug or
 * names no term is `null`. Throws a `RangeError` on a `count` outside 1 to
 * 100, since the caller passes a constant, not input.
 *
 * Tagged like the listing it is a longer page of: `listingTags({ type })`,
 * so the entry a resource or term event clears is the one the next build
 * would read. The URL differs from every listing page's (`per_page`), so it
 * shares no Data Cache entry with one. A resource the reader schema refuses
 * is skipped, as on a listing page.
 */
export async function listRecentResources(options: RecentResourcesOptions): Promise<WpResource[] | null> {
  const { type, count } = options;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_INCLUDE) {
    throw new RangeError(`count must be 1 to ${MAX_INCLUDE}, not ${String(count)}`);
  }
  if (type !== undefined && !isTypeSlug(type)) {
    return null;
  }
  const typeTerm = type === undefined ? undefined : await getTermBySlug("resource_type", type);
  if (typeTerm === null) {
    return null;
  }
  const params = new URLSearchParams({ per_page: String(count), orderby: "date", order: "desc" });
  if (typeTerm !== undefined) params.set("resource_type", String(typeTerm.id));
  const { data } = await cmsGetListOk({
    path: "/wp/v2/resources",
    query: `_embed&${params.toString()}`,
    tags: listingTags(type === undefined ? {} : { type }),
    itemSchema: wpResourceSchema,
  });
  return data.items;
}

/**
 * The published resource whose slug is `slug`, or `null`. A slug that cannot
 * be one (`isSlug`) is `null` without a request. The slug is canonicalised
 * first, so `Example` reads `example`: the data layer only normalises, and
 * the page redirects a non-canonical URL (the rules are in
 * `lib/canonical-path.ts`). The canonical form is the one WordPress stores,
 * sent as the query value so the CMS compares it as stored.
 *
 * Tagged `resourceFetchTags(slug)`, a miss included: a miss is a 200 with an
 * empty list, which the Data Cache keeps, so a publish under the slug must
 * clear it.
 *
 * An answer that lists resources but none with this slug throws a
 * `CmsError` (reason `schema`) rather than being a miss: core's `slug`
 * filter only returns exact matches, so other resources mean the filter was
 * dropped (a plugin, a proxy rewriting the query) and the CMS is answering
 * a different question. A miss there would turn every resource page into a
 * 404 and hide the fault, as `getResourceById` refuses a body for another ID.
 *
 * The answer is a list, so it is parsed per item like a listing, and the
 * check above runs on what passed. Core returns at most one resource here,
 * and an answer in which every resource failed throws whatever its size: a
 * matching resource that fails the schema must fail the page, which ISR
 * then keeps serving from its last good render, rather than become a miss,
 * which would replace it with a 404. A bad stranger beside a good match is
 * skipped; with no good match the read throws, saying that items were
 * skipped.
 */
export async function getResourceBySlug(slug: string): Promise<WpResource | null> {
  if (!isSlug(slug)) {
    return null;
  }
  const canonical = canonicalSlug(slug);
  const path = "/wp/v2/resources";
  const { data } = await cmsGetListOk({
    path,
    query: `_embed&${new URLSearchParams({ slug: canonical }).toString()}`,
    tags: resourceFetchTags(canonical),
    itemSchema: wpResourceSchema,
  });
  if (data.items.length === 0) {
    if (data.skipped > 0) {
      throw new CmsError(path, "schema", `every resource in the answer fails the reader schema; the first: ${data.firstSkipped}`, 200);
    }
    return null;
  }
  const match = data.items.find((resource) => canonicalSlug(resource.slug) === canonical);
  if (match === undefined) {
    const detail =
      data.skipped === 0
        ? "the body lists resources, none with the slug asked for"
        : `the body lists resources, none with the slug asked for among those that pass the reader schema (${data.skipped} skipped)`;
    throw new CmsError(path, "schema", detail, 200);
  }
  return match;
}

/**
 * The published resource with this ID, or `null`: for a non-ID without a
 * request, for core's 404 `rest_post_invalid_id` (no such post), and for its
 * 401 `rest_forbidden`, which is how core answers an anonymous reader asking
 * for a draft or a trashed post. Neither error is kept by the Data Cache,
 * which stores only 200s, so a miss is asked again on the next render.
 *
 * Treating the 401 as a miss is right for core, but if a REST-lockdown
 * plugin on the CMS answered every anonymous reader with 401, every by-ID
 * read would become a 404 page, while the list and slug reads, which treat
 * any 401 as an error, would throw and fail loudly.
 *
 * Tagged `resourceByIdTags()`.
 */
export async function getResourceById(id: number): Promise<WpResource | null> {
  if (!isPostId(id)) {
    return null;
  }
  const path = `/wp/v2/resources/${id}`;
  const result = await cmsGet({
    path,
    query: "_embed",
    tags: resourceByIdTags(),
    schema: wpResourceSchema,
    misses: [
      { status: 404, code: "rest_post_invalid_id" },
      { status: 401, code: "rest_forbidden" },
    ],
  });
  if (result.kind === "miss") {
    return null;
  }
  if (result.kind !== "ok") {
    throw new CmsError(path, "status", "an answer the request did not expect");
  }
  if (result.data.id !== id) {
    throw new CmsError(path, "schema", "the body is a different resource", 200);
  }
  return result.data;
}

export interface GetResourcesByIdsOptions {
  /** The slug of the page the list sits on, for `relatedTags`. */
  readonly hostSlug: string;
}

/**
 * The published resources among `ids`, in the order given (`include` with
 * `orderby=include`): for the related section (`components/RelatedSection.tsx`),
 * after the plugin's related route (`getRelated` in `related.ts`) has chosen
 * and ordered them (issue #50; the contract is in `packages/ui/README.md`).
 * An ID that is not published
 * is simply absent. Repeated IDs are asked for once; no IDs is an empty list
 * without a request. Throws a `RangeError` on a value that is not a post ID,
 * on more than 100 IDs, or on a bad `hostSlug`: the caller passes IDs from a
 * parsed response and its own slug, so any of these is a bug.
 *
 * Tagged `relatedTags(hostSlug)`.
 *
 * Parsed per item: a resource the reader schema refuses is absent like an
 * unpublished one, and logged. For fewer than four IDs that holds even when
 * every resource fails, which gives an empty list. For four or more, more
 * than half failing throws a `CmsError`, a systematic fault the page that
 * renders the section must contain.
 */
export async function getResourcesByIds(
  ids: readonly number[],
  { hostSlug }: GetResourcesByIdsOptions,
): Promise<WpResource[]> {
  const wanted = [...new Set(ids)];
  const bad = wanted.find((id) => !isPostId(id));
  if (bad !== undefined) {
    throw new RangeError(`Not a post ID: ${String(bad)}`);
  }
  if (wanted.length > MAX_INCLUDE) {
    throw new RangeError(`At most ${MAX_INCLUDE} IDs can be read at once, not ${wanted.length}`);
  }
  const tags = relatedTags(hostSlug);
  if (wanted.length === 0) {
    return [];
  }
  const { data } = await cmsGetListOk({
    path: "/wp/v2/resources",
    // IDs are digits, so the list needs no encoding; commas keep it readable in logs and cache keys.
    query: `_embed&include=${wanted.join(",")}&orderby=include&per_page=${wanted.length}`,
    tags,
    itemSchema: wpResourceSchema,
  });
  return data.items.filter((resource) => wanted.includes(resource.id));
}
