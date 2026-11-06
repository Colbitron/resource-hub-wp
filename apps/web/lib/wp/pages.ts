import "server-only";

import { pageTags } from "../tags";
import { CmsError, cmsGet, cmsGetOk } from "./fetch";
import { pageResponseSchema, type PageLookup } from "./schemas/page";
import { wpPageSchema, type WpPage } from "./schemas/rest";

/**
 * WordPress pages (ADR 0051): which published page a public path names,
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
 */
export async function lookupPage(path: string): Promise<PageLookup | null> {
  const { data } = await cmsGetOk({
    path: "/resource-hub/v1/page",
    query: new URLSearchParams({ path }).toString(),
    tags: pageTags(),
    schema: pageResponseSchema,
  });
  return data.page;
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
