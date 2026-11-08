import "server-only";

import { searchTags } from "../tags";
import { CmsError, cmsGet } from "./fetch";
import { readPagesByIds } from "./pages";
import { readResourcesByIds } from "./resources";
import type { WpPage, WpResource } from "./schemas/rest";
import { MAX_SEARCH_PAGE, searchResponseSchema } from "./schemas/search";

/**
 * Search (issue #115; the contract is `packages/ui/README.md`, "Search"):
 * the plugin's `GET /resource-hub/v1/search?q=…&page=n`, which answers one
 * page of matching resource and page IDs with their kinds, and then the
 * objects, read per kind with `include={ids}&orderby=include` as the related
 * section reads its resources. The `/search/` page calls it
 * (`components/SearchPage.tsx`), the one dynamic route (ADR 0043, amended):
 * its render runs on every request, and a repeated query reads these from
 * the Data Cache with no CMS request (measured on Vercel and under `next
 * start`; `docs/architecture/caching.md`, "The search page").
 *
 * The query is normalised here exactly as the plugin normalises it
 * (`SearchRoute::normalize_query()`): every run of whitespace becomes one
 * space and the ends are trimmed, then it must be 2 to 100 code points. The
 * page sends the normalised form, so the Data Cache key (the URL) and the
 * CMS's object-cache key name the same query, and a query the CMS would
 * refuse is refused here without a request.
 */

/** The shortest query, in code points once normalised: the plugin's `MIN_QUERY_LENGTH`. */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/** The longest query, in code points once normalised: the plugin's `MAX_QUERY_LENGTH`. */
export const MAX_SEARCH_QUERY_LENGTH = 100;

/**
 * One run of whitespace as PHP's PCRE matches `\s` with the `u` flag, which
 * the plugin collapses: JavaScript's `\s` without U+FEFF, which PCRE does not
 * count, and with U+0085 and U+180E, which it does. `test/wp-search.test.ts`
 * pins the difference code point by code point, with the plugin's own test.
 */
const WHITESPACE_RUN = /(?:[^\S\uFEFF]|[\u0085\u180E])+/gu;

/** The query as the plugin searches for it: whitespace runs collapsed to one space, the ends trimmed. */
export function normalizeSearchQuery(raw: string): string {
  return raw.replace(WHITESPACE_RUN, " ").replace(/^ | $/g, "");
}

/**
 * The query to search for, normalised, or `null` when the plugin would
 * refuse it: shorter than 2 or longer than 100 code points once normalised.
 */
export function searchQuery(raw: string): string | null {
  const query = normalizeSearchQuery(raw);
  const length = [...query].length;
  return length >= MIN_SEARCH_QUERY_LENGTH && length <= MAX_SEARCH_QUERY_LENGTH ? query : null;
}

/** One match with the object it names, in the route's order. */
export type SearchHit =
  | { readonly type: "resource"; readonly resource: WpResource }
  | { readonly type: "page"; readonly page: WpPage };

export interface SearchResults {
  /** This page's matches the collections returned, in the route's order; one unpublished since is absent. */
  readonly items: SearchHit[];
  /** Every match, as the CMS counts them; it can exceed what `pages` lists. */
  readonly total: number;
  /** How many pages can be asked for: 0 to `MAX_SEARCH_PAGE`. */
  readonly pages: number;
}

/** Whether this process has logged a `rest_no_route` from the search route yet (`searchSite`). */
let warnedNoRoute = false;

/**
 * Page `page` of the published resources and pages matching `query`, or
 * `null` when the CMS has no search route: core's 404 `rest_no_route`, which
 * a CMS a deploy behind answers, so the caller can show that search is not
 * available rather than fail; logged once per process, never naming the CMS
 * origin. Anything else the route answers, a 400 included, is a `CmsError`:
 * the query was checked here against the plugin's own rules, so a 400 means
 * the two sides disagree.
 *
 * Every fetch is tagged `searchTags()`, fixed before the request. The route
 * is asked once, then the resources and the pages it names, the two reads at
 * once and only for a kind that has matches. A match whose object the
 * collection does not return (unpublished between the reads) is left out, so
 * a page can list fewer than the route named; so is a page with its content
 * protected, which the route never names, as a guard; and a repeated ID is
 * kept once, at its first place. `total` and `pages` are the route's.
 *
 * Throws a `RangeError` without a request on a query that is not already
 * normalised and in bounds (`searchQuery(query) !== query`) or a page outside
 * 1 to `MAX_SEARCH_PAGE`: the caller normalises a visitor's input with
 * `searchQuery` first, so either is a bug.
 */
export async function searchSite(query: string, page = 1): Promise<SearchResults | null> {
  if (searchQuery(query) !== query) {
    throw new RangeError("query must be normalised and 2 to 100 characters long; pass it through searchQuery first");
  }
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_SEARCH_PAGE) {
    throw new RangeError(`page must be 1 to ${MAX_SEARCH_PAGE}, not ${String(page)}`);
  }
  const tags = searchTags();
  const path = "/resource-hub/v1/search";
  const result = await cmsGet({
    path,
    query: new URLSearchParams({ q: query, page: String(page) }).toString(),
    tags,
    schema: searchResponseSchema,
    misses: [{ status: 404, code: "rest_no_route" }],
  });
  if (result.kind === "miss") {
    if (!warnedNoRoute) {
      warnedNoRoute = true;
      console.warn(`searchSite: ${path} answered rest_no_route, so the CMS has no search route; answering no search (logged once per process)`);
    }
    return null;
  }
  if (result.kind !== "ok") {
    throw new CmsError(path, "status", "an answer the request did not expect");
  }
  const { items, total, pages } = result.data;
  const idsOf = (type: SearchHit["type"]) => items.filter((item) => item.type === type).map((item) => item.id);
  const [resources, wpPages] = await Promise.all([readResourcesByIds(idsOf("resource"), tags), readPagesByIds(idsOf("page"), tags)]);
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
  const pageById = new Map(wpPages.filter((wpPage) => !wpPage.content.protected).map((wpPage) => [wpPage.id, wpPage]));
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (item.type === "resource") {
      const resource = resourceById.get(item.id);
      if (resource !== undefined) {
        hits.push({ type: "resource", resource });
      }
    } else {
      const wpPage = pageById.get(item.id);
      if (wpPage !== undefined) {
        hits.push({ type: "page", page: wpPage });
      }
    }
  }
  return { items: hits, total, pages };
}
