import "server-only";

import { relatedTags } from "../tags";
import { hasVisibleTitle, toCard, type CardData } from "./cards";
import { CmsError, cmsGet } from "./fetch";
import { MAX_RELATED_ITEMS, relatedResponseSchema, type RelatedItem } from "./schemas/related";
import type { WpResource } from "./schemas/rest";

/**
 * The plugin's related route, `GET /resource-hub/v1/related/{id}?count=n`
 * (issue #50; the contract is in `packages/ui/README.md`): the IDs of the
 * resources related to one published resource, picks first and then the
 * newest sharing a topic, merged on the CMS. The resource page's related
 * section (`components/RelatedSection.tsx`) calls this once and then reads
 * the objects with `getResourcesByIds`, so one code path renders a resource
 * everywhere.
 */

/** How many related resources the section asks for: the route's own default. */
export const RELATED_COUNT = 3;

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
 * A resource as a row of a related list, or `null` when it is left out: a
 * resource with no visible title (`hasVisibleTitle`: nothing but whitespace
 * and zero-width characters, the rule a listing's row falls back to
 * "Untitled resource" on) or no type (`toCard` is `null` for one that
 * cannot have a URL). The owner's rule of 2026-11-07 for the related lists
 * alone: a related row is a recommendation, and a row that says "Untitled
 * resource", or names no type, recommends nothing. The listings keep their
 * fallback, since there every published resource must be reachable. The
 * related section shows fewer rows for it; the block over-fetches a little
 * to keep its count (`components/RelatedResources.tsx`).
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
