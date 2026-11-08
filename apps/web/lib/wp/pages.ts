import "server-only";

import { pageTags } from "../tags";
import { CmsError, cmsGet, cmsGetListOk } from "./fetch";
import { pageResponseSchema, type PageLookup } from "./schemas/page";
import { wpPageSchema, type WpPage } from "./schemas/rest";

/**
 * WordPress pages (ADR 0052): which published page a public path names,
 * through the plugin's `GET /resource-hub/v1/page?path=…`, and one page by
 * ID from core's `/wp/v2/pages/{id}`. Both are tagged `pages`, the one tag
 * every page event clears.
 */

/** A WordPress post ID: a positive safe integer. */
function isPostId(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 1;
}

/**
 * The published page the plugin serves at `path`, with its canonical path
 * now, or `null` for none. `path` is a page path in canonical form (`/`, or
 * `/about/team/` from `pagePath`); the caller has validated its segments. A
 * miss is a 200 with `page: null`, which the Data Cache keeps under `pages`,
 * so the root with no front page and the paths crawlers try cost the CMS one
 * request until the next page event.
 *
 * Two errors are misses too, neither cached since the Data Cache stores
 * only 200s: the plugin's 400 `rest_invalid_param`, which it sends only for
 * a path over its length cap, so a visitor's URL can never make the page
 * fail; and core's 404 `rest_no_route`, which a CMS without the plugin's
 * route answers, so a front end a deploy ahead of the CMS (a preview against
 * the hosted CMS, a CMS rollback) shows the welcome page at `/` and a 404
 * elsewhere rather than a 500. That is the one place a missing route is not
 * an error: everywhere else the data layer throws on it, because it means a
 * missing plugin or route, not a missing object (`fetch.ts`).
 */
export async function lookupPage(path: string): Promise<PageLookup | null> {
  const requestPath = "/resource-hub/v1/page";
  const result = await cmsGet({
    path: requestPath,
    query: new URLSearchParams({ path }).toString(),
    tags: pageTags(),
    schema: pageResponseSchema,
    misses: [
      { status: 400, code: "rest_invalid_param" },
      { status: 404, code: "rest_no_route" },
    ],
  });
  if (result.kind === "miss") {
    return null;
  }
  if (result.kind !== "ok") {
    throw new CmsError(requestPath, "status", "an answer the request did not expect");
  }
  return result.data.page;
}

/**
 * The published page with this ID, or `null`: for a non-ID without a request,
 * for core's 404 `rest_post_invalid_id` (no such post) and for its 401
 * `rest_forbidden`, which is how core answers an anonymous reader asking for
 * a draft, a private or a trashed page. A lookup names only published pages,
 * so a miss here means the page changed between the two reads; the caller
 * treats it as not found, and the next page event clears both.
 */
export async function getPageById(id: number): Promise<WpPage | null> {
  if (!isPostId(id)) {
    return null;
  }
  const path = `/wp/v2/pages/${id}`;
  const result = await cmsGet({
    path,
    query: "",
    tags: pageTags(),
    schema: wpPageSchema,
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
    throw new CmsError(path, "schema", "the body is a different page", 200);
  }
  return result.data;
}

/** Core's largest `per_page`, and so the most IDs one `include` read can return. */
const MAX_INCLUDE = 100;

/**
 * The published pages among `ids`, in the order given (`include` with
 * `orderby=include`), read with `tags`: for the search results (`searchSite`
 * in `search.ts`), after the plugin's search route has chosen and ordered
 * them. Without `_embed`: a page's reader schema reads nothing embedded. An ID
 * that is not a published page is absent, and so is a page the reader schema
 * refuses, logged, as in every collection read (`cmsGetList` in `fetch.ts`).
 * Repeated IDs are asked for once; no IDs is an empty list without a request.
 * Throws a `RangeError` on a value that is not a post ID or on more than 100
 * IDs: the caller passes IDs from a parsed response, so either is a bug.
 */
export async function readPagesByIds(ids: readonly number[], tags: readonly string[]): Promise<WpPage[]> {
  const wanted = [...new Set(ids)];
  const bad = wanted.find((id) => !isPostId(id));
  if (bad !== undefined) {
    throw new RangeError(`Not a post ID: ${String(bad)}`);
  }
  if (wanted.length > MAX_INCLUDE) {
    throw new RangeError(`At most ${MAX_INCLUDE} IDs can be read at once, not ${wanted.length}`);
  }
  if (wanted.length === 0) {
    return [];
  }
  const { data } = await cmsGetListOk({
    path: "/wp/v2/pages",
    query: `include=${wanted.join(",")}&orderby=include&per_page=${wanted.length}`,
    tags,
    itemSchema: wpPageSchema,
  });
  return data.items.filter((page) => wanted.includes(page.id));
}
