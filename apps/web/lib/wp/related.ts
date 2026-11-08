import "server-only";

import { canonicalSlug } from "../routes";
import { relatedBlockTags, relatedTags } from "../tags";
import { hasVisibleTitle, toCard, type CardData } from "./cards";
import { CmsError, cmsGet, cmsGetListOk } from "./fetch";
import { MAX_RELATED_ITEMS, relatedResponseSchema, type RelatedItem } from "./schemas/related";
import { wpResourceSchema, type WpResource } from "./schemas/rest";

/**
 * The two related reads (issue #50; the contract is in
 * `packages/ui/README.md`). The plugin's related route,
 * `GET /resource-hub/v1/related/{id}?count=n`: the IDs of the resources
 * related to one published resource, picks first and then the newest
 * sharing a topic, merged on the CMS; the resource page's related section
 * (`components/RelatedSection.tsx`) calls `getRelated` once and then reads
 * the objects with `getResourcesByIds`, so one code path renders a resource
 * everywhere. And the related-resources block's list
 * (`components/RelatedResources.tsx`): the newest resources in one topic
 * from core's collection, `getNewestInTopic`.
 */

/** Core's largest `per_page`. */
const MAX_PER_PAGE = 100;

/** How many related resources the section asks for: the route's own default. */
export const RELATED_COUNT = 3;

/** Whether this process has logged a `rest_no_route` from the related route yet (`getRelated`). */
let warnedNoRoute = false;

/** A WordPress post ID: a positive safe integer. */
function isPostId(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 1;
}

export interface GetRelatedOptions {
  /** The slug of the page the list sits on, for `relatedTags`. */
  readonly hostSlug: string;
  /** How many, 1 to `MAX_RELATED_ITEMS`; the route's default of `RELATED_COUNT` when left out. */
  readonly count?: number;
}

/**
 * The resources related to the published resource `id`, in display order,
 * or `null` when the CMS has no answer for it: core's 404 `rest_no_route`,
 * which a CMS without the plugin's route answers, so a front end a deploy
 * ahead of the CMS renders the page without its related section rather
 * than failing it; and the plugin's 404 `resource_hub_not_found`, which
 * means the resource stopped being published between the page's own read
 * and this one, and its page becomes a 404 on its next render. Neither 404
 * is kept by the Data Cache, so a CMS that gains the route is asked again
 * on the next render. Anything else the route answers is a `CmsError`,
 * which the section catches around itself.
 *
 * Each `null` logs a `console.warn` naming the route's path, never the CMS
 * origin: `resource_hub_not_found` every time, since the host was read as
 * published a moment before and a run of them means the two reads
 * disagree; `rest_no_route` once per process, since it is expected for a
 * deploy while the CMS catches up and would otherwise fill the log on every
 * render, yet a plugin deactivated for good must not be invisible.
 *
 * `count` is sent as asked for, so the request says what it wants and the
 * cache entry is the one a different count would not share. Throws a
 * `RangeError` on a value that is not a post ID or a `count` outside 1 to
 * `MAX_RELATED_ITEMS`: the caller passes the host's own ID and a constant,
 * so either is a bug.
 *
 * The contract says the list never names the resource itself and never an
 * ID twice; both are still dropped here, as a guard, so a CMS that broke
 * the rule could not put a page in its own related list.
 *
 * Tagged `relatedTags(hostSlug)`.
 */
export async function getRelated(id: number, { hostSlug, count = RELATED_COUNT }: GetRelatedOptions): Promise<RelatedItem[] | null> {
  if (!isPostId(id)) {
    throw new RangeError(`Not a post ID: ${String(id)}`);
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_RELATED_ITEMS) {
    throw new RangeError(`count must be 1 to ${MAX_RELATED_ITEMS}, not ${String(count)}`);
  }
  const tags = relatedTags(hostSlug);
  const path = `/resource-hub/v1/related/${id}`;
  const result = await cmsGet({
    path,
    query: `count=${count}`,
    tags,
    schema: relatedResponseSchema,
    misses: [
      { status: 404, code: "rest_no_route" },
      { status: 404, code: "resource_hub_not_found" },
    ],
  });
  if (result.kind === "miss") {
    if (result.code !== "rest_no_route") {
      console.warn(`getRelated: ${path} answered ${result.code} for a resource read as published; rendering without the related list`);
    } else if (!warnedNoRoute) {
      warnedNoRoute = true;
      console.warn(`getRelated: ${path} answered rest_no_route, so the CMS has no related route; rendering without related lists (logged once per process)`);
    }
    return null;
  }
  if (result.kind !== "ok") {
    throw new CmsError(path, "status", "an answer the request did not expect");
  }
  const seen = new Set<number>([id]);
  return result.data.items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

/**
 * How many more resources than its `count` the block asks for, so that the
 * ones it leaves out still leave it `count` rows: one for the post the block
 * sits in, which is in its own topic and is always left out, and five for
 * resources with no visible title or no type (`toRelatedCard`). Six is small
 * next to a page of a listing (12) and more than a library this size has
 * ever had to drop; a topic with more than five such resources in a row
 * leaves the block short, which is the right side to err on. With `count`
 * at most `MAX_RELATED_ITEMS` the read is at most 16 resources.
 */
export const RELATED_BLOCK_SPARE = 6;

export interface NewestInTopicOptions {
  /** The `resource_topic` term's ID, which the REST filter takes. */
  readonly topicId: number;
  /** The same term's current slug, which names the `topic:{slug}` tag. */
  readonly topicSlug: string;
  /** How many, 1 to 100 (core's largest `per_page`). */
  readonly count: number;
}

/** The query argument that puts the topic's slug in the block's request URL, for its cache key alone (`getNewestInTopic`). */
export const RELATED_BLOCK_TOPIC_PARAM = "rh_topic";

/**
 * The `count` most recently published resources in the topic `topicId`,
 * newest first, with `_embed`: the related-resources block's list before
 * the block leaves out the post it sits in and the rows `toRelatedCard`
 * refuses. One page of `count` at `orderby=date&order=desc`, core's default
 * order written out so the request says what it asks for. Core orders by
 * `post_date` alone here, with no ID tie-break, where the CMS's own lists
 * order by date DESC then ID DESC, so two resources published in the same
 * second may come in a different order here than in the related route's
 * topic fill. The block takes both the ID and the slug from the marker
 * (`packages/ui/README.md`, "Block marker"), so no term lookup is made.
 *
 * The URL also carries the topic's canonical slug as `rh_topic`
 * (`RELATED_BLOCK_TOPIC_PARAM`), which core ignores, as it ignores any
 * query argument the route does not register: only so the Data Cache key,
 * which is the URL, names the slug the tags are made from
 * (`relatedBlockTags`). The URL names no host, so every block for one
 * topic, slug and count shares one entry.
 *
 * Tagged `relatedBlockTags(topicSlug)`. Throws a `RangeError` on a
 * `topicId` that is not a term ID, a `count` outside 1 to 100, or a slug
 * that cannot be a tag: the caller passes a validated marker's attributes
 * and a constant, so any of these is a bug. A resource the reader schema
 * refuses is skipped, as on a listing page (`cmsGetList` in `fetch.ts`).
 */
export async function getNewestInTopic({ topicId, topicSlug, count }: NewestInTopicOptions): Promise<WpResource[]> {
  if (!isPostId(topicId)) {
    throw new RangeError(`Not a term ID: ${String(topicId)}`);
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PER_PAGE) {
    throw new RangeError(`count must be 1 to ${MAX_PER_PAGE}, not ${String(count)}`);
  }
  const tags = relatedBlockTags(topicSlug);
  const params = new URLSearchParams({
    per_page: String(count),
    orderby: "date",
    order: "desc",
    resource_topic: String(topicId),
    [RELATED_BLOCK_TOPIC_PARAM]: canonicalSlug(topicSlug),
  });
  const { data } = await cmsGetListOk({
    path: "/wp/v2/resources",
    query: `_embed&${params.toString()}`,
    tags,
    itemSchema: wpResourceSchema,
  });
  return data.items;
}

/**
 * A resource as a row of a related list, or `null` when it is left out: a
 * resource with no visible title (`hasVisibleTitle`: nothing but whitespace
 * and zero-width characters, the rule a listing's row falls back to
 * "Untitled resource" on) or no type (`toCard` is `null` for one that
 * cannot have a URL). The owner's rule of 2026-11-07 for the related lists
 * alone: a related row is a recommendation, and a row that says "Untitled
 * resource", or names no type, recommends nothing. The listings keep their
 * fallback, since there every published resource must be reachable. The
 * related section shows fewer rows for it; the block over-fetches a little
 * to keep its count (`RELATED_BLOCK_SPARE`, `components/RelatedResources.tsx`).
 */
export function toRelatedCard(resource: WpResource): CardData | null {
  return hasVisibleTitle(resource.title.rendered) ? toCard(resource) : null;
}

/**
 * `resources` in the order `ids` gives them, each once, without any resource
 * whose ID is not in `ids`: the related route decides the order (picks
 * first, then the topic fill), and `getResourcesByIds` asks for that order
 * with `orderby=include`, but what the section shows is fixed here from the
 * route's answer rather than trusted to the collection's ordering.
 */
export function inRelatedOrder(ids: readonly number[], resources: readonly WpResource[]): WpResource[] {
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const ordered: WpResource[] = [];
  for (const id of new Set(ids)) {
    const resource = byId.get(id);
    if (resource !== undefined) {
      ordered.push(resource);
    }
  }
  return ordered;
}
