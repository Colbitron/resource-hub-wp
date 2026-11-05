import "server-only";

import { canonicalSlug, isPageNumber, isSlug, isTypeSlug } from "../routes";
import { flagListingTags, listingTags, relatedTags, resourceByIdTags, resourceFetchTags } from "../tags";
import { CmsError, cmsGet, cmsGetOk, NO_SUCH_PAGE, readPagination, type NoSuchPage } from "./fetch";
import { wpResourceListSchema, wpResourceSchema, type WpResource } from "./schemas/rest";
import { getTermBySlug } from "./terms";

/**
 * Resources from `/wp/v2/resources`, always with `_embed`, which the reader
 * schema relies on for terms and the featured image: a page of a listing,
 * one by slug, one by ID, and several by ID in a given order.
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
  readonly items: WpResource[];
  /** Resources across every page. */
  readonly total: number;
  /** Pages at `RESOURCES_PER_PAGE`; 0 when nothing matches. */
  readonly totalPages: number;
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
 * - `null` when a slug cannot be one or names no term: the page calls
 *   `notFound()`.
 * - `NO_SUCH_PAGE` when `page` is not a page number, or is past the last
 *   page: core's 400 `rest_post_invalid_page_number` when there is anything
 *   to page through, and an empty page past the first when there is not.
 *
 * Tagged from the request, before any lookup: `listingTags({ type, topic })`,
 * plus `flagListingTags()` with a flag.
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
  const result = await cmsGet({
    path,
    query: `_embed&${params.toString()}`,
    tags,
    schema: wpResourceListSchema,
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
  return { items: result.data, total, totalPages };
}

/**
 * The published resource whose slug is `slug`, or `null`. A slug that cannot
 * be one (`isSlug`) is `null` without a request. The slug is canonicalised
 * first, so `Example` reads `example`: the data layer only normalises, and
 * the page redirects a non-canonical URL (ADR 0049). The canonical form is
 * the one WordPress stores, sent as the query value so the CMS compares it
 * as stored.
 *
 * Tagged `resourceFetchTags(slug)`, a miss included: a miss is a 200 with an
 * empty list, which the Data Cache keeps, so a publish under the slug must
 * clear it.
 */
export async function getResourceBySlug(slug: string): Promise<WpResource | null> {
  if (!isSlug(slug)) {
    return null;
  }
  const canonical = canonicalSlug(slug);
  const { data } = await cmsGetOk({
    path: "/wp/v2/resources",
    query: `_embed&${new URLSearchParams({ slug: canonical }).toString()}`,
    tags: resourceFetchTags(canonical),
    schema: wpResourceListSchema,
  });
  return data.find((resource) => canonicalSlug(resource.slug) === canonical) ?? null;
}

/**
 * The published resource with this ID, or `null`: for a non-ID without a
 * request, for core's 404 `rest_post_invalid_id` (no such post), and for its
 * 401 `rest_forbidden`, which is how core answers an anonymous reader asking
 * for a draft or a trashed post. Neither error is kept by the Data Cache,
 * which stores only 200s, so a miss is asked again on the next render.
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
 * `orderby=include`): for the related section, after the plugin's related
 * route has chosen and ordered them (ADR 0030). An ID that is not published
 * is simply absent. Repeated IDs are asked for once; no IDs is an empty list
 * without a request. Throws a `RangeError` on a value that is not a post ID,
 * on more than 100 IDs, or on a bad `hostSlug`: the caller passes IDs from a
 * parsed response and its own slug, so any of these is a bug.
 *
 * Tagged `relatedTags(hostSlug)`.
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
  const { data } = await cmsGetOk({
    path: "/wp/v2/resources",
    // IDs are digits, so the list needs no encoding; commas keep it readable in logs and cache keys.
    query: `_embed&include=${wanted.join(",")}&orderby=include&per_page=${wanted.length}`,
    tags,
    schema: wpResourceListSchema,
  });
  return data.filter((resource) => wanted.includes(resource.id));
}
